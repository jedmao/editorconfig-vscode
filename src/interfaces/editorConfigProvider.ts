import * as editorconfig from 'editorconfig';
import {
	TextDocument
} from 'vscode';

export interface EditorConfigProvider {
	getSettingsForDocument(doc: TextDocument): editorconfig.knownProps;
	getDefaultSettings();
}
