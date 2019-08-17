import get = require('lodash.get')
import * as path from 'path'
import {
	Disposable,
	Selection,
	TextDocument,
	TextDocumentSaveReason,
	TextEdit,
	TextEditorOptions,
	window,
	workspace,
	languages,
} from 'vscode'
import {
	InsertFinalNewline,
	PreSaveTransformation,
	SetEndOfLine,
	TrimTrailingWhitespace,
} from './transformations'

import {
	applyTextEditorOptions,
	pickWorkspaceDefaults,
	resolveCoreConfig,
	resolveFile,
	resolveTextEditorOptions,
} from './api'

const failedLangs: string[] = []

export default class DocumentWatcher {
	private disposable: Disposable
	private defaults?: TextEditorOptions
	private preSaveTransformations: PreSaveTransformation[] = [
		new SetEndOfLine(),
		new TrimTrailingWhitespace(),
		new InsertFinalNewline(),
	]
	private doc?: TextDocument

	public constructor(
		private outputChannel = window.createOutputChannel('EditorConfig'),
	) {
		this.log('Initializing document watcher...')

		const subscriptions: Disposable[] = []

		subscriptions.push(
			window.onDidChangeActiveTextEditor(async editor => {
				if (editor && editor.document) {
					this.init((this.doc = editor.document))
				}
			}),
		)

		subscriptions.push(
			window.onDidChangeWindowState(async state => {
				if (state.focused && this.doc) {
					this.init(this.doc)
				}
			}),
		)

		subscriptions.push(workspace.onDidChangeConfiguration(this.onConfigChanged))

		subscriptions.push(
			workspace.onDidSaveTextDocument(doc => {
				if (path.basename(doc.fileName) === '.editorconfig') {
					this.log('.editorconfig file saved.')
					this.onConfigChanged()
				}
			}),
		)

		subscriptions.push(
			workspace.onWillSaveTextDocument(async e => {
				let selections: Selection[] = []
				const activeEditor = window.activeTextEditor
				const activeDoc = get(activeEditor, 'document')
				if (activeDoc && activeDoc === e.document && activeEditor) {
					selections = activeEditor.selections
				}
				const transformations = this.calculatePreSaveTransformations(
					e.document,
					e.reason,
				)
				e.waitUntil(transformations)
				if (selections.length) {
					await transformations
					if (activeEditor) {
						activeEditor.selections = selections
					}
				}
			}),
		)

		this.disposable = Disposable.from.apply(this, subscriptions)
		this.onConfigChanged()
	}

	private async init(this: DocumentWatcher, doc: TextDocument) {
		const [newOptions, editorconfigSettings] = await resolveTextEditorOptions(
			doc,
			{
				defaults: this.defaults,
				onEmptyConfig: this.onEmptyConfig,
			},
		)
		applyTextEditorOptions(newOptions, {
			onNoActiveTextEditor: this.onNoActiveTextEditor,
			onSuccess: this.onSuccess,
		})
		if (editorconfigSettings.language) {
			const langs = (editorconfigSettings.language as string)
				.split(/\s*,\s*/)
				.filter(Boolean)
				.map(x => x.toLowerCase().trim())
				.filter(x => !failedLangs.includes(x))
			const originalId = doc.languageId
			for (const lang of langs) {
				if (lang === originalId) {
					break
				}
				this.log('trying to set language:', lang)
				try {
					// eslint-disable-next-line no-await-in-loop
					await languages.setTextDocumentLanguage(doc, lang)
				} catch (err) {
					this.log(err.message)
					failedLangs.push(lang)
					continue
				}
				this.log('success!')
			}
		}
	}

	public onEmptyConfig = (relativePath: string) => {
		this.log(`${relativePath}: No configuration.`)
	}

	public onBeforeResolve = (relativePath: string) => {
		this.log(`${relativePath}: Using EditorConfig core...`)
	}

	public onNoActiveTextEditor = () => {
		this.log('No more open editors.')
	}

	public onSuccess = (newOptions: TextEditorOptions) => {
		if (!this.doc) {
			this.log(`[no file]: ${JSON.stringify(newOptions)}`)
			return
		}
		const { relativePath } = resolveFile(this.doc)
		this.log(`${relativePath}: ${JSON.stringify(newOptions)}`)
	}

	public log(...messages: string[]) {
		this.outputChannel.appendLine(messages.join(' '))
	}

	public dispose() {
		this.disposable.dispose()
	}

	public onConfigChanged = () => {
		this.log(
			'Detected change in configuration:',
			JSON.stringify((this.defaults = pickWorkspaceDefaults())),
		)
	}

	private async calculatePreSaveTransformations(
		doc: TextDocument,
		reason: TextDocumentSaveReason,
	): Promise<TextEdit[]> {
		const editorconfigSettings = await resolveCoreConfig(doc, {
			onBeforeResolve: this.onBeforeResolve,
		})
		const relativePath = workspace.asRelativePath(doc.fileName)

		if (!editorconfigSettings) {
			this.log(`${relativePath}: No configuration found for pre-save.`)
			return []
		}

		return Array.prototype.concat.call(
			[],
			...this.preSaveTransformations.map(transformer => {
				const { edits, message } = transformer.transform(
					editorconfigSettings,
					doc,
					reason,
				)
				if (edits instanceof Error) {
					this.log(`${relativePath}: ${edits.message}`)
				}
				if (message) {
					this.log(`${relativePath}: ${message}`)
				}
				return edits
			}),
		)
	}
}
