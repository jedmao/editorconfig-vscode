import * as editorconfig from 'editorconfig';
import * as path from 'path';
import {
	window,
	workspace,
	Disposable,
	TextDocument,
	TextEditor,
	TextEditorOptions,
	TextEdit
} from 'vscode';
import { fromEditorConfig } from './Utils';
import {
	InsertFinalNewline,
	PreSaveTransformation,
	SetEndOfLine,
	TrimTrailingWhitespace
} from './transformations';
import {
	EditorConfigProvider
} from './interfaces/editorConfigProvider';

class DocumentWatcher implements EditorConfigProvider {

	private docToConfigMap: { [fileName: string]: editorconfig.knownProps };
	private disposable: Disposable;
	private defaults: TextEditorOptions;
	private preSaveTransformations: PreSaveTransformation[] = [
		new TrimTrailingWhitespace(),
		new InsertFinalNewline(),
		new SetEndOfLine()
	];

	constructor(
		private outputChannel = window.createOutputChannel('EditorConfig')
	) {
		this.log('Initializing document watcher...');

		const subscriptions: Disposable[] = [];

		subscriptions.push(window.onDidChangeActiveTextEditor(editor => {
			if (editor && editor.document) {
				this.onDidOpenDocument(editor.document);
			}
		}));

		subscriptions.push(workspace.onDidChangeConfiguration(
			this.onConfigChanged.bind(this)
		));

		subscriptions.push(workspace.onDidSaveTextDocument(async doc => {
			if (path.basename(doc.fileName) === '.editorconfig') {
				this.log('.editorconfig file saved.');
				await this.rebuildConfigMap();
			}
		}));

		subscriptions.push(workspace.onWillSaveTextDocument(async e => {
			e.waitUntil(this.calculatePreSaveTransformations(e.document));
		}));

		this.disposable = Disposable.from.apply(this, subscriptions);
		this.rebuildConfigMap();
		this.onConfigChanged();
	}

	private log(...messages: string[]) {
		this.outputChannel.appendLine(messages.join(' '));
	}

	public dispose() {
		this.disposable.dispose();
	}

	public getSettingsForDocument(doc: TextDocument) {
		return this.docToConfigMap[doc.fileName];
	}

	public getDefaultSettings() {
		return this.defaults;
	}

	private async rebuildConfigMap() {
		this.log('Rebuilding config map...');
		this.docToConfigMap = {};
		return await Promise.all(workspace.textDocuments.map(
			doc => this.onDidOpenDocument(doc)
		));
	}

	private async onDidOpenDocument(doc: TextDocument) {
		if (doc.isUntitled) {
			this.log('Skipped untitled document.');
			return;
		}
		const fileName = doc.fileName;
		const relativePath = workspace.asRelativePath(fileName);
		this.log(`Applying configuration to ${relativePath}...`);

		if (this.docToConfigMap[fileName]) {
			this.log('Using configuration map...');
			this.applyEditorConfigToTextEditor(window.activeTextEditor);
			return;
		}

		this.log('Using EditorConfig core...');
		return editorconfig.parse(fileName)
			.then(async (config: editorconfig.knownProps) => {
				if (config.indent_size === 'tab') {
					config.indent_size = config.tab_width;
				}

				this.docToConfigMap[fileName] = config;

				this.applyEditorConfigToTextEditor(window.activeTextEditor);
			});
	}

	private applyEditorConfigToTextEditor(
		editor: TextEditor,
	) {
		if (!editor) {
			this.log('No more open editors.');
			return Promise.resolve();
		}

		const doc = editor.document;
		const relativePath = workspace.asRelativePath(doc.fileName);
		const editorconfig = this.getSettingsForDocument(doc);

		if (!editorconfig) {
			this.log(`No configuration for ${relativePath}.`);
			return Promise.resolve();
		}

		editor.options = fromEditorConfig(
			editorconfig,
			this.getDefaultSettings()
		);

		this.log(`${relativePath}: ${JSON.stringify(editor.options)}`);

		return editor.options;
	}

	private onConfigChanged() {
		const workspaceConfig = workspace.getConfiguration('editor');
		const detectIndentation = workspaceConfig.get<boolean>('detectIndentation');

		this.defaults = (detectIndentation) ? {} : {
			tabSize: workspaceConfig.get<string | number>('tabSize'),
			insertSpaces: workspaceConfig.get<string | boolean>('insertSpaces')
		};
		this.log(
			'Detected change in configuration:',
			JSON.stringify(this.defaults)
		);
	}

	private async calculatePreSaveTransformations(
		doc: TextDocument
	): Promise<TextEdit[]> {
		const editorconfig = this.getSettingsForDocument(doc);
		const relativePath = workspace.asRelativePath(doc.fileName);

		if (!editorconfig) {
			this.log(`Pre-save: No configuration found for ${relativePath}.`);
			return [];
		}

		this.log(`Applying pre-save transformations to ${relativePath}.`);

		return Array.prototype.concat.call([],
			...this.preSaveTransformations.map(
				transformer => transformer.transform(editorconfig, doc)
			)
		);
	}
}

export default DocumentWatcher;
