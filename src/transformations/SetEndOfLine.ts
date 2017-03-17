import * as editorconfig from 'editorconfig';
import { EndOfLineEdit } from 'vscode';

import PreSaveTransformation from './PreSaveTransformation';

class SetEndOfLine extends PreSaveTransformation {

	private eolMap = {
		lf: EndOfLineEdit.LF,
		crlf: EndOfLineEdit.CRLF
	};

	transform(editorconfig: editorconfig.knownProps) {
		const edit = this.eolMap[
			(editorconfig.end_of_line || '').toLowerCase()
		];
		return (edit) ? [edit] : [];
	}
}

export default SetEndOfLine;
