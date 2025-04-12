import { useEditor, EditorContent, Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import { useEffect, useState, useCallback } from 'react';
import { BlogPost, loadBlogPost, saveBlogPost } from '../utils/fileOperations';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import { common, createLowlight } from 'lowlight';
import typescript from 'highlight.js/lib/languages/typescript';
import 'highlight.js/styles/github-dark.css';
import { marked } from 'marked';
import Underline from '@tiptap/extension-underline';
import Link from '@tiptap/extension-link';
import hljs from 'highlight.js';
import { Node } from '@tiptap/core';
import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from 'prosemirror-state';
import { DecorationSet, Decoration } from 'prosemirror-view';

// Create a new lowlight instance with the common language bundle
const lowlight = createLowlight(common);
// Add TypeScript language support to the existing common languages
lowlight.register('typescript', typescript);

// Configure marked to use highlight.js for syntax highlighting
const renderer = new marked.Renderer();
renderer.code = ({ text, lang }) => {
  // Check if the language is valid and registered, default to 'plaintext' if not
  const validLanguage = hljs.getLanguage(lang || '') ? lang || 'plaintext' : 'plaintext';
  const highlighted = hljs.highlight(text, { language: validLanguage }).value;
  return `<pre><code class="hljs language-${validLanguage}">${highlighted}</code></pre>`;
};

marked.setOptions({
  renderer,
  gfm: true,
});

interface MarkdownEditorProps {
  documentId?: string;
  onChange?: (value: string) => void;
  onEditorReady?: (editor: any) => void;
  onContentChange?: (content: string) => void;
}

const CustomDocument = Node.create({
  name: 'doc',
  topNode: true,
  content: 'block+',
});

// Add debounce utility function at the top level
const debounce = (fn: Function, ms: number) => {
  let timer: NodeJS.Timeout;
  return (...args: any[]) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
};

const suggestionPluginKey = new PluginKey('suggestion');

const Autocomplete = Extension.create({
  name: 'autocomplete',

  addProseMirrorPlugins() {
    let suggestionTimer: NodeJS.Timeout;
    let currentSuggestion: string | null = null;

    return [
      new Plugin({
        key: suggestionPluginKey,
        props: {
          decorations: (state) => {
            if (!currentSuggestion) return DecorationSet.empty;
            
            const { selection } = state;
            if (!selection.empty) return DecorationSet.empty;

            const widget = document.createElement('span');
            widget.className = 'inline-suggestion';
            widget.textContent = currentSuggestion;
            
            return DecorationSet.create(state.doc, [
              Decoration.widget(selection.from, widget)
            ]);
          },

          handleKeyDown: (view, event) => {
            if (event.key === 'Tab' && currentSuggestion) {
              event.preventDefault();
              
              const { state } = view;
              const { selection } = state;
              
              try {
                // Check if we're in a valid node for text insertion
                const $pos = state.doc.resolve(selection.from);
                const node = $pos.parent;
                
                // Only allow text insertion in certain node types
                if (!['paragraph', 'heading', 'text'].includes(node.type.name)) {
                  return false;
                }
                
                // Create a transaction that respects the document structure
                const tr = state.tr.insertText(currentSuggestion, selection.from);
                
                if (tr.docChanged) {
                  view.dispatch(tr);
                  currentSuggestion = null;
                  return true;
                }
              } catch (error) {
                console.error('Error applying suggestion:', error);
                currentSuggestion = null;
              }
              return false;
            }
            return false;
          }
        }
      }),

      new Plugin({
        key: new PluginKey('autocomplete-trigger'),
        view: () => ({
          update: (view) => {
            const { state } = view;
            const { selection } = state;
            if (!selection.empty) {
              if (currentSuggestion) {
                currentSuggestion = null;
                view.dispatch(state.tr.setMeta('suggestion', null));
              }
              return;
            }

            const currentText = state.doc.textBetween(0, selection.from);

            clearTimeout(suggestionTimer);
            suggestionTimer = setTimeout(async () => {
              try {
                const response = await fetch('/api/autocomplete', {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                  },
                  body: JSON.stringify({
                    text: currentText,
                    context: state.doc.textContent,
                  }),
                });

                if (response.ok) {
                  const { completion } = await response.json();
                  if (completion && view.state === state) {
                    currentSuggestion = completion;
                    view.dispatch(state.tr.setMeta('suggestion', completion));
                  }
                }
              } catch (error) {
                console.error('Autocomplete error:', error);
              }
            }, 2000);
          }
        })
      })
    ];
  }
});

const MarkdownEditor: React.FC<MarkdownEditorProps> = ({
  documentId,
  onChange,
  onEditorReady,
  onContentChange,
}) => {
  const [currentDoc, setCurrentDoc] = useState<BlogPost | null>(null);

  const editor = useEditor({
    extensions: [
      CustomDocument,
      StarterKit.configure({
        heading: {
          levels: [1, 2, 3, 4, 5, 6],
        },
        codeBlock: false,
        document: false,
      }),
      CodeBlockLowlight.configure({
        lowlight,
        defaultLanguage: 'plaintext', // Default to plaintext if unspecified
      }),
      Underline,
      Link.configure({
        openOnClick: false,
      }),
      Placeholder.configure({
        placeholder: ({ node, editor, pos }) => {
          // Placeholder for the first node if it's an H1
          if (node.type.name === 'heading' && node.attrs.level === 1 && pos === 0) {
            return 'Enter title...';
          }
          // Placeholder for the second node if it's a paragraph (assuming H1 is first)
          const firstNode = editor.state.doc.content.firstChild;
          if (
            node.type.name === 'paragraph' &&
            firstNode && firstNode.type.name === 'heading' &&
            pos === firstNode.nodeSize // Position is immediately after the first node
          ) {
            return 'Start writing here...';
          }
          // Placeholder for the first node if it's a paragraph (no H1)
          if (node.type.name === 'paragraph' && pos === 0) {
            return 'Start writing here...';
          }
          return ''; // Return empty string or null for no placeholder
        },
        showOnlyWhenEditable: true,
        showOnlyCurrent: false, // Show placeholders even when cursor isn't directly inside
        includeChildren: false,
      }),
      Autocomplete,
    ],
    editorProps: {
      attributes: {
        // Use a more specific class for styling to avoid conflicts
        class: 'prose prose-sm max-w-none focus:outline-none w-full px-8 py-4 text-gray-800 bg-white overflow-visible markdown-editor-content',
      },
    },
    // Set initial content structure to allow placeholders
    content: '<h1></h1><p></p>',
    onUpdate: ({ editor }) => {
      const htmlContent = editor.getHTML();
      const textContent = editor.getText(); // Get plain text content
      onChange?.(htmlContent); // Keep passing HTML if needed elsewhere
      onContentChange?.(textContent); // Pass plain text to parent for context

      // Debounced save logic
      if (currentDoc && documentId) {
        debouncedSave(editor.getHTML()); // Save HTML content
      }
    },
  });

  // Define the debounced save function
  const debouncedSave = useCallback(
    debounce((htmlContent: string) => {
      if (currentDoc && documentId) {
        const updatedDoc = {
          ...currentDoc,
          // Important: Save the editor's HTML content, not markdown initially
          // Conversion to markdown should happen on save *if* that's the storage format
          content: htmlContent,
          lastModified: new Date(),
        };
        saveBlogPost(updatedDoc).then(setCurrentDoc);
      }
    }, 1000), // Debounce time (e.g., 1 second)
    [currentDoc, documentId] // Dependencies for useCallback
  );

  useEffect(() => {
    if (editor) {
      onEditorReady?.(editor);
    }
  }, [editor, onEditorReady]);

  useEffect(() => {
    if (documentId) {
      loadDocument(documentId);
    } else {
      // If no documentId, reset editor to default placeholder state
      if (editor && !editor.isDestroyed) {
        editor.commands.setContent('<h1></h1><p></p>');
        setCurrentDoc(null); // Clear current document state
      }
    }
  }, [documentId, editor]); // Add editor to dependencies

  const loadDocument = async (id: string) => {
    if (!editor || editor.isDestroyed) return; // Ensure editor is available
    try {
      const doc = await loadBlogPost(id);
      if (doc) {
        setCurrentDoc(doc);
        let htmlContent = '';
        // Check if content exists and is not just whitespace or empty structures
        if (doc.content && doc.content.trim() && doc.content.trim() !== '<p></p>' && doc.content.trim() !== '<h1></h1><p></p>') {
          // Assume content is stored as HTML, otherwise convert from Markdown
          // If stored as Markdown: htmlContent = marked(doc.content);
          htmlContent = doc.content; // Assuming stored as HTML for now
        } else {
          // If content is empty or just placeholder structure, set default
          htmlContent = '<h1></h1><p></p>';
        }
        // Use 'replaceContent' to avoid merging histories if possible
        editor.commands.setContent(htmlContent, false); // 'false' to not emit update initially
        // Pass initial text content to parent
        onContentChange?.(editor.getText());
      } else {
         // Document not found, reset to default
         editor.commands.setContent('<h1></h1><p></p>');
         setCurrentDoc(null);
         onContentChange?.(''); // Clear content in parent
      }
    } catch (error) {
      console.error('Error loading document:', error);
      // Optionally reset editor on error
      editor.commands.setContent('<h1></h1><p></p>');
      setCurrentDoc(null);
      onContentChange?.('');
    }
  };

  return (
    <div className="w-full h-full max-w-4xl mx-auto bg-white shadow-lg rounded-lg overflow-y-auto">
      <style>
        {`
          /* Target the specific editor class */
          .markdown-editor-content {
            padding: 2rem !important;
            min-height: calc(100vh - 4rem); /* Adjust based on header height */
            height: auto !important;
            outline: none !important; /* Ensure no focus outline */
          }

          /* Generic placeholder style targeting the Tiptap class */
          .markdown-editor-content .ProseMirror__placeholder {
             color: #adb5bd;
             font-style: italic;
             pointer-events: none;
             height: 0;
             position: absolute; /* Needed for Tiptap's placeholder */
          }

          /* Specific placeholders if needed, using data-placeholder attribute */
          .markdown-editor-content h1.is-empty:first-child::before {
            content: attr(data-placeholder);
            float: left;
            color: #adb5bd;
            pointer-events: none;
            height: 0;
            font-style: italic;
          }
          .markdown-editor-content p.is-empty::before {
            content: attr(data-placeholder);
            float: left;
            color: #adb5bd;
            pointer-events: none;
            height: 0;
            font-style: italic;
          }

          /* Rest of your existing styles */
          .prose {
            font-size: 0.925rem;
            line-height: 1.6;
          }
          .prose h1 {
            font-size: 1.75rem;
            margin-top: 0;
            margin-bottom: 1rem;
            line-height: 1.3;
          }
          .prose h2 {
            font-size: 1.4rem;
            margin-top: 1.5rem;
            margin-bottom: 0.75rem;
          }
          .prose h3 {
            font-size: 1.2rem;
            margin-top: 1.25rem;
            margin-bottom: 0.75rem;
          }
          .prose p {
            margin-top: 0.75rem;
            margin-bottom: 0.75rem;
          }
          .prose pre {
            background-color: #1f2937;
            color: #f3f4f6;
            padding: 0.75rem;
            border-radius: 0.375rem;
            margin: 0.75rem 0;
            font-size: 0.875rem;
          }
          .prose code {
            color: #ef4444;
            background-color: #fee2e2;
            padding: 0.2rem 0.4rem;
            border-radius: 0.25rem;
            font-size: 0.875rem;
          }
          .prose pre code {
            color: inherit;
            background-color: transparent;
            padding: 0;
          }
          .prose ul, .prose ol {
            margin-top: 0.75rem;
            margin-bottom: 0.75rem;
            padding-left: 1.25rem;
          }
          .prose li {
            margin-top: 0.375rem;
            margin-bottom: 0.375rem;
          }
          .prose blockquote {
            border-left: 4px solid #e5e7eb;
            padding-left: 1rem;
            margin: 1rem 0;
            color: #4b5563;
            font-style: italic;
          }
          .suggestion {
            background-color: #e5e7eb;
            border-radius: 0.25rem;
            padding: 0.125rem 0.25rem;
            margin: 0 0.125rem;
            opacity: 0.8;
          }
          .suggestion-popup {
            position: fixed;
            z-index: 1000;
            background-color: #4F46E5;
            color: white;
            padding: 4px 8px;
            border-radius: 4px;
            font-size: 0.95em;
            box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
            pointer-events: none;
            animation: pulse 2s infinite;
            font-family: monospace;
            display: none;
          }
          .suggestion-popup::before {
            content: '⌨️ Press Tab';
            position: absolute;
            top: -20px;
            left: 0;
            background-color: #1F2937;
            padding: 2px 6px;
            border-radius: 4px;
            font-size: 0.8em;
            white-space: nowrap;
          }
          @keyframes pulse {
            0% { transform: scale(1); }
            50% { transform: scale(1.05); }
            100% { transform: scale(1); }
          }
          .ProseMirror {
            min-height: 100vh;
            position: relative;
          }
          .inline-suggestion {
            color: #9CA3AF;
            opacity: 0.6;
            font-style: italic;
            margin-left: 1px;
            user-select: none;
            pointer-events: none;
            position: relative;
            display: inline;
          }
        `}
      </style>
      {/* Ensure EditorContent takes full height */}
      <EditorContent editor={editor} className="w-full h-full" />
    </div>
  );
};

export default MarkdownEditor; 