import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';

// Define the structure for storing modifications
interface Modification {
  id: string;
  from: number;
  to: number;
  newText: string;
}

// Define the options for the extension (if any needed later)
interface DiffOptions {
  // Placeholder for future options
}

// Define commands that can be called on the editor
declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    diff: {
      /**
       * Adds a new modification suggestion.
       */
      addDiff: (modification: Omit<Modification, 'id'>) => ReturnType;
      /**
       * Clears all current modification suggestions.
       */
      clearDiffs: () => ReturnType;
      /**
       * Accepts the modification suggestion nearest to the cursor.
       */
      acceptDiff: () => ReturnType;
    };
  }
}

export const DiffExtension = Extension.create<DiffOptions>({
  name: 'diff',

  addOptions() {
    return {
      // Default options here
    };
  },

  // Storage for pending modifications within the extension instance
  addStorage() {
    return {
      modifications: [] as Modification[],
      modificationCounter: 0,
    };
  },

  addCommands() {
    return {
      addDiff: (modification) => ({ editor, commands }) => {
        const id = `mod-${this.storage.modificationCounter++}`;
        this.storage.modifications.push({ ...modification, id });
        // We need to trigger an update to re-render decorations
        editor.view.dispatch(editor.view.state.tr.setMeta('diffUpdate', true));
        return true;
      },
      clearDiffs: () => ({ editor }) => {
        this.storage.modifications = [];
        this.storage.modificationCounter = 0;
         // We need to trigger an update to re-render decorations
        editor.view.dispatch(editor.view.state.tr.setMeta('diffUpdate', true));
        return true;
      },
      acceptDiff: () => ({ editor, state, dispatch }) => {
        const { selection } = state;
        const pos = selection.$from.pos; // Current cursor position

        // Find the modification nearest to the cursor (needs better logic)
        const modification = this.storage.modifications.find(mod => {
            // Basic check: cursor is within or adjacent to the modification span
            // TODO: Improve logic to find the *intended* one if multiple are close
            return pos >= mod.from && pos <= mod.to + mod.newText.length; // Approximate range
        });
        
        if (modification) {
            const { from, to, newText, id } = modification;
            
            // Create the text node WITHOUT any initial marks
            const newNode = state.schema.text(newText); 
            
            // Start transaction: replace the diff range with the new node
            let tr = state.tr.replaceWith(from, to, newNode);
            const insertEndPos = from + newNode.nodeSize; // Position after the inserted node

            // --- Re-apply existing TextStyle mark (containing font-family) --- 
            // Resolve position *just before* insertion to check context marks
            const $posBefore = tr.doc.resolve(from); 
            const marksAtPos = $posBefore.marks(); // Get marks active at the insertion point

            // Find the TextStyle mark specifically
            const textStyleMark = marksAtPos.find(mark => mark.type.name === 'textStyle');

            if (textStyleMark && textStyleMark.attrs.fontFamily) {
                // If a TextStyle mark with a font family exists, apply it to the inserted text
                tr = tr.addMark(from, insertEndPos, textStyleMark);
            } else {
                // Optional: If no specific font mark, ensure any existing TextStyle mark *without* 
                // a font family is removed (to reset to default font if needed).
                // This might be needed if the deleted text had a font style.
                const existingTextStyle = state.schema.marks.textStyle;
                if (existingTextStyle) { 
                    tr = tr.removeMark(from, insertEndPos, existingTextStyle);
                }
            }
            // --- End re-apply --- 

            // Remove the accepted modification from storage
            this.storage.modifications = this.storage.modifications.filter(m => m.id !== id);
            
            // Set meta to update decorations and dispatch the transaction
            tr.setMeta('diffUpdate', true); 
            if (dispatch) {
              dispatch(tr);
            }
            return true;
        }
        return false;
      },
    };
  },

  addProseMirrorPlugins() {
    const extensionThis = this; // Reference to extension instance

    // Helper function defined inside to access extensionThis directly
    const createDecorationsForPlugin = (doc) => {
      const decorations: Decoration[] = [];
      extensionThis.storage.modifications.forEach(mod => {
        // Decoration for the text to be deleted
        decorations.push(
          Decoration.inline(mod.from, mod.to, { class: 'diff-delete' }, { 'data-mod-id': mod.id })
        );
        // Widget decoration for the text to be inserted (after the deleted part)
        const widget = document.createElement('span');
        widget.className = 'diff-insert';
        widget.textContent = mod.newText;
        widget.dataset.modId = mod.id; // Associate widget with mod ID
        decorations.push(
          Decoration.widget(mod.to, widget, { side: 1 }) // side: 1 means insert after position 'to'
        );
      });
      return DecorationSet.create(doc, decorations);
    };

    return [
      new Plugin({
        key: new PluginKey('diffDecorations'),
        state: {
          init(_, { doc }) {
            // Initialize decoration set using the inner helper
            return createDecorationsForPlugin(doc);
          },
          apply(tr, oldSet, oldState, newState) {
             // Check if our meta key was set, or if the document changed
             if (tr.getMeta('diffUpdate') || tr.docChanged) {
               // Recreate decorations using the inner helper
              return createDecorationsForPlugin(newState.doc);
             }
            // Otherwise, map existing decorations
            return oldSet.map(tr.mapping, tr.doc);
          },
        },
        props: {
          decorations(state) {
            return this.getState(state);
          },
        },
      }),
      // Plugin to handle Tab key press
      new Plugin({
        key: new PluginKey('diffTabHandler'),
        props: {
          handleKeyDown: (view, event) => {
            if (event.key === 'Tab') {
              // Helper function defined inside handleKeyDown to check proximity
              const isNearModificationCheck = (state) => {
                const { selection } = state;
                const pos = selection.$from.pos;
                return extensionThis.storage.modifications.some(mod => pos >= mod.from && pos <= mod.to + 1);
              };

              const nearModification = isNearModificationCheck(view.state);
              
              if (nearModification) {
                // Try to accept the diff using the command via extensionThis.editor
                const accepted = extensionThis.editor.commands.acceptDiff(); 
                
                if (accepted) {
                  event.preventDefault(); // Prevent default Tab behavior
                  return true; // Mark event as handled
                }
              }
            }
            return false; // Event not handled
          },
        },
      }),
    ];
  },

});

export default DiffExtension; 