// CodeMirror 6 for the page (plan UI Components, Step 3). The packages are ES modules served under /vendor/codemirror
// and named by index.html's import map; this module imports what the page uses and puts it on window.CodeMirror6
// for the plain scripts (mirror.js), then says it is ready. The anchor map (anchormap.js) comes with it.

import { EditorState, Compartment, StateField, StateEffect, RangeSet, RangeSetBuilder } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection, rectangularSelection, crosshairCursor, Decoration } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search';
import { syntaxHighlighting, defaultHighlightStyle, HighlightStyle, foldGutter, foldKeymap } from '@codemirror/language';
import { tags } from '@lezer/highlight';
import { markdown } from '@codemirror/lang-markdown';
import * as AnchorMap from './anchormap.js';

window.CodeMirror6 = {
	EditorState: EditorState,
	Compartment: Compartment,
	StateField: StateField,
	StateEffect: StateEffect,
	RangeSet: RangeSet,
	RangeSetBuilder: RangeSetBuilder,
	EditorView: EditorView,
	keymap: keymap,
	lineNumbers: lineNumbers,
	highlightActiveLine: highlightActiveLine,
	highlightActiveLineGutter: highlightActiveLineGutter,
	drawSelection: drawSelection,
	rectangularSelection: rectangularSelection,
	crosshairCursor: crosshairCursor,
	Decoration: Decoration,
	defaultKeymap: defaultKeymap,
	history: history,
	historyKeymap: historyKeymap,
	indentWithTab: indentWithTab,
	searchKeymap: searchKeymap,
	highlightSelectionMatches: highlightSelectionMatches,
	syntaxHighlighting: syntaxHighlighting,
	defaultHighlightStyle: defaultHighlightStyle,
	HighlightStyle: HighlightStyle,
	tags: tags,
	foldGutter: foldGutter,
	foldKeymap: foldKeymap,
	markdown: markdown,
	AnchorMap: AnchorMap,
};

document.dispatchEvent( new CustomEvent( 'codemirror-ready' ) );
