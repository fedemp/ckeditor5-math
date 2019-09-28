import Plugin from '@ckeditor/ckeditor5-core/src/plugin';
import Clipboard from '@ckeditor/ckeditor5-clipboard/src/clipboard';
import Undo from '@ckeditor/ckeditor5-undo/src/undo';
import LiveRange from '@ckeditor/ckeditor5-engine/src/model/liverange';
import LivePosition from '@ckeditor/ckeditor5-engine/src/model/liveposition';

import { defaultConfig, removeDelimiters, EQUATION_REGEXP } from './utils';

export default class AutoMath extends Plugin {
	static get requires() {
		return [ Clipboard, Undo ];
	}

	static get pluginName() {
		return 'AutoMath';
	}

	constructor( editor ) {
		super( editor );

		this._timeoutId = null;

		this._positionToInsert = null;
	}

	init() {
		const editor = this.editor;
		const modelDocument = editor.model.document;

		this.listenTo( editor.plugins.get( Clipboard ), 'inputTransformation', () => {
			const firstRange = modelDocument.selection.getFirstRange();

			const leftLivePosition = LivePosition.fromPosition( firstRange.start );
			leftLivePosition.stickiness = 'toPrevious';

			const rightLivePosition = LivePosition.fromPosition( firstRange.end );
			rightLivePosition.stickiness = 'toNext';

			modelDocument.once( 'change:data', () => {
				this._mathBetweenPositions( leftLivePosition, rightLivePosition );

				leftLivePosition.detach();
				rightLivePosition.detach();
			}, { priority: 'high' } );
		} );

		editor.commands.get( 'undo' ).on( 'execute', () => {
			if ( this._timeoutId ) {
				global.window.clearTimeout( this._timeoutId ); // eslint-disable-line
				this._positionToInsert.detach();

				this._timeoutId = null;
				this._positionToInsert = null;
			}
		}, { priority: 'high' } );
	}

	_mathBetweenPositions( leftPosition, rightPosition ) {
		const editor = this.editor;

		const mathConfig = {
			...defaultConfig,
			...this.editor.config.get( 'math' )
		};

		const equationRange = new LiveRange( leftPosition, rightPosition );
		const walker = equationRange.getWalker( { ignoreElementEnd: true } );

		let equation = '';

		// Get equation text
		for ( const node of walker ) {
			if ( node.item.is( 'textProxy' ) ) {
				equation += node.item.data;
			}
		}

		equation = equation.trim();

		// Check if equation
		if ( !equation.match( EQUATION_REGEXP ) ) {
			return;
		}

		const mathCommand = editor.commands.get( 'math' );

		// Do not anything if math element cannot be inserted at the current position
		if ( !mathCommand.isEnabled ) {
			return;
		}

		this._positionToInsert = LivePosition.fromPosition( leftPosition );

		// With timeout user can undo conversation if want use plain text
		this._timeoutId = global.window.setTimeout( () => { // eslint-disable-line
			editor.model.change( writer => {
				this._timeoutId = null;

				writer.remove( equationRange );

				let insertPosition;

				// Check if position where the math element should be inserted is still valid.
				if ( this._positionToInsert.root.rootName !== '$graveyard' ) {
					insertPosition = this._positionToInsert;
				}

				editor.model.change( writer => {
					const params = {
						...removeDelimiters( equation ),
						type: mathConfig.outputType,
					};
					const mathElement = writer.createElement( 'mathtex', params );

					editor.model.insertContent( mathElement, insertPosition );

					writer.setSelection( mathElement, 'on' );
				} );

				this._positionToInsert.detach();
				this._positionToInsert = null;
			} );
		}, 100 );
	}
}
