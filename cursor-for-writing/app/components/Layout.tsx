import { FC, ReactNode, useState, useEffect, KeyboardEvent, useRef } from 'react';
import {
  Bars3Icon,
  PlusIcon,
  TrashIcon,
  ClockIcon,
  DocumentDuplicateIcon,
  LinkIcon,
  CodeBracketIcon,
  BoldIcon,
  ItalicIcon,
  UnderlineIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  PencilIcon,
  ChatBubbleLeftIcon,
  PlusCircleIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import { BlogPost, getAllBlogPosts, saveBlogPost } from '../utils/fileOperations';
import { Editor } from '@tiptap/react';
import { openai } from '@ai-sdk/openai';
import { VercelAIToolSet } from 'composio-core';
import { generateText } from 'ai';
import { marked } from 'marked';
import hljs from 'highlight.js';
import 'highlight.js/styles/github-dark.css';
import ReactMarkdown from 'react-markdown';
import { Components } from 'react-markdown';

// Configure marked to use highlight.js for syntax highlighting
const renderer = new marked.Renderer();
renderer.code = ({ text, lang }) => {
  const language = hljs.getLanguage(lang || '') ? lang || 'plaintext' : 'plaintext';
  const highlighted = hljs.highlight(text, { language }).value;
  return `<pre><code class="hljs language-${language}">${highlighted}</code></pre>`;
};

marked.setOptions({
  renderer,
  gfm: true,
  breaks: true,
});

interface LayoutProps {
  children: ReactNode;
  onDocumentSelect?: (id: string | null) => void;
  editor?: Editor | null;
  onContentChange?: (content: string) => void;
  editorContent: string;
}

interface Selection {
  text: string;
  from: number;
  to: number;
  fileName?: string;
}

const Layout: FC<LayoutProps> = ({ children, onDocumentSelect, editor, onContentChange, editorContent }) => {
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [documents, setDocuments] = useState<BlogPost[]>([]);
  const [selectedDoc, setSelectedDoc] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingTitleId, setEditingTitleId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');
  const [showHistory, setShowHistory] = useState(false);
  const [aiOutput, setAiOutput] = useState('');
  const [userInput, setUserInput] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [isTitleFocused, setIsTitleFocused] = useState(false);
  const [isDescriptionFocused, setIsDescriptionFocused] = useState(false);
  const [showSelectionToolbar, setShowSelectionToolbar] = useState(false);
  const [selectionPosition, setSelectionPosition] = useState({ top: 0, left: 0 });
  const selectionToolbarRef = useRef<HTMLDivElement>(null);
  const [selectedTexts, setSelectedTexts] = useState<Selection[]>([]);
  const [mode, setMode] = useState<'ask' | 'agent'>('agent');

  useEffect(() => {
    loadDocuments();
  }, []);

  useEffect(() => {
    if (!editor) return;

    const handleSelectionUpdate = () => {
      const { from, to } = editor.state.selection;
      const hasSelection = from !== to;

      if (hasSelection) {
        // Get selection coordinates
        const domSelection = window.getSelection();
        if (domSelection && domSelection.rangeCount > 0) {
          const range = domSelection.getRangeAt(0);
          const rect = range.getBoundingClientRect();
          
          // Position toolbar above selection
          setSelectionPosition({
            top: rect.top - 40, // 40px above selection
            left: rect.left + (rect.width / 2), // Centered horizontally
          });
        }
        setShowSelectionToolbar(true);
      } else {
        setShowSelectionToolbar(false);
      }
    };

    // Listen for selection changes in the editor
    editor.on('selectionUpdate', handleSelectionUpdate);

    // Cleanup
    return () => {
      editor.off('selectionUpdate', handleSelectionUpdate);
    };
  }, [editor]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        selectionToolbarRef.current &&
        !selectionToolbarRef.current.contains(event.target as Node)
      ) {
        setShowSelectionToolbar(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  const handleContentChange = (content: string) => {
    // This function is now unused as editorContent is received as a prop
  };

  const loadDocuments = async () => {
    try {
      setIsLoading(true);
      setError(null);
      const posts = await getAllBlogPosts();
      setDocuments(posts);
      if (posts.length > 0 && !selectedDoc) {
        handleDocumentSelect(posts[0].id);
      }
    } catch (error) {
      setError('Failed to load documents');
      console.error('Error loading documents:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleDocumentSelect = (id: string) => {
    setSelectedDoc(id);
    onDocumentSelect?.(id);
    setEditingTitleId(null);
  };

  const createNewDocument = async () => {
    try {
      setError(null);
      const newDoc: BlogPost = {
        id: `blog${Date.now()}`,
        title: 'Untitled',
        content: '# Untitled\n\nStart writing here...',
        status: 'Draft',
        lastModified: new Date(),
      };
      await saveBlogPost(newDoc);
      await loadDocuments();
      handleDocumentSelect(newDoc.id);
      setEditingTitleId(newDoc.id);
      setEditingTitle('Untitled');
    } catch (error) {
      setError('Failed to create new document');
      console.error('Error creating document:', error);
    }
  };

  const startEditingTitle = (doc: BlogPost, event: React.MouseEvent) => {
    event.stopPropagation();
    setEditingTitleId(doc.id);
    setEditingTitle(doc.title);
  };

  const handleTitleKeyDown = async (event: KeyboardEvent<HTMLInputElement>, doc: BlogPost) => {
    if (event.key === 'Enter') {
      await saveTitle(doc);
    } else if (event.key === 'Escape') {
      setEditingTitleId(null);
    }
  };

  const saveTitle = async (doc: BlogPost) => {
    if (editingTitle.trim() === '') return;
    
    try {
      const updatedDoc = {
        ...doc,
        title: editingTitle.trim(),
        lastModified: new Date(),
      };
      await saveBlogPost(updatedDoc);
      await loadDocuments();
      setEditingTitleId(null);
    } catch (error) {
      console.error('Failed to update title:', error);
    }
  };

  const deleteDocument = async (event: React.MouseEvent) => {
    event.preventDefault();
    if (!selectedDoc) return;

    const doc = documents.find(d => d.id === selectedDoc);
    if (!doc) return;

    const confirmDelete = window.confirm(`Are you sure you want to delete "${doc.title}"?`);
    if (!confirmDelete) return;

    try {
      // Remove from documents array
      const updatedDocs = documents.filter(d => d.id !== selectedDoc);
      setDocuments(updatedDocs);
      
      // Select the next available document
      if (updatedDocs.length > 0) {
        handleDocumentSelect(updatedDocs[0].id);
      } else {
        setSelectedDoc(null);
        onDocumentSelect?.(null);
      }

      // TODO: Add actual deletion from storage
    } catch (error) {
      console.error('Failed to delete document:', error);
      // Reload documents to ensure consistency
      loadDocuments();
    }
  };

  const duplicateDocument = async (event: React.MouseEvent) => {
    event.preventDefault();
    if (!selectedDoc) return;

    const doc = documents.find(d => d.id === selectedDoc);
    if (!doc) return;

    try {
      const newDoc: BlogPost = {
        ...doc,
        id: `blog${Date.now()}`,
        title: `${doc.title} (Copy)`,
        lastModified: new Date(),
        status: 'Draft',
      };
      await saveBlogPost(newDoc);
      await loadDocuments();
      handleDocumentSelect(newDoc.id);
    } catch (error) {
      console.error('Failed to duplicate document:', error);
    }
  };

  const publishDocument = async (event: React.MouseEvent) => {
    event.preventDefault();
    if (!selectedDoc) return;

    const doc = documents.find(d => d.id === selectedDoc);
    if (!doc) return;

    try {
      const updatedDoc: BlogPost = {
        ...doc,
        status: doc.status === 'Published' ? 'Draft' : 'Published',
        lastModified: new Date(),
      };
      await saveBlogPost(updatedDoc);
      await loadDocuments();
    } catch (error) {
      console.error('Failed to publish document:', error);
    }
  };

  const toggleHistory = (event: React.MouseEvent) => {
    event.preventDefault();
    setShowHistory(!showHistory);
    // TODO: Implement history view
  };

  const toggleChat = () => {
    setIsChatOpen(!isChatOpen);
  };

  // Add function to detect mode from user input
  const detectMode = (input: string): 'ask' | 'agent' => {
    // Keywords that suggest document modification (agent mode)
    const agentKeywords = [
      'edit', 'change', 'modify', 'update', 'replace', 'write',
      'add', 'delete', 'remove', 'insert', 'generate', 'create',
      'fix', 'correct', 'improve', 'rewrite', 'revise', 'format'
    ];
    
    const inputLower = input.toLowerCase();
    
    // Check if input contains any agent keywords
    const containsAgentKeyword = agentKeywords.some(keyword => 
      inputLower.includes(keyword)
    );
    
    // If there are selected texts, default to agent mode
    if (selectedTexts.length > 0) return 'agent';
    
    // If the input suggests document modification, use agent mode
    if (containsAgentKeyword) return 'agent';
    
    // Default to ask mode for general questions
    return 'ask';
  };

  const generateAIContent = async () => {
    if (!userInput.trim() || isGenerating) return;
    if (mode === 'agent' && !editor) return;

    setIsGenerating(true);
    setAiOutput('Generating response...');

    try {
      // Use editorContent prop
      const currentContent = editorContent; 
      
      // Send selected text data if any exists, regardless of mode
      const selectedTextsData = selectedTexts.length > 0 
        ? selectedTexts.map(selection => ({
            text: selection.text,
            from: selection.from,
            to: selection.to,
            fileName: selection.fileName
          }))
        : undefined;

      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ 
          message: userInput, 
          currentContent, // Pass editor content
          selections: selectedTextsData,
          mode
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to generate response');
      }

      const data = await response.json();

      if (data.type === 'chat') {
        // Handle chat response
        setAiOutput(data.chatResponse);
        setUserInput('');
      } else if (mode === 'agent' && editor) {
        // Handle document modifications
        if (data.type === 'modification' && data.modifications) {
          // Apply each modification in reverse order (to maintain position accuracy)
          const sortedMods = [...data.modifications].sort((a, b) => b.from - a.from);
          
          for (const mod of sortedMods) {
            editor.chain()
              .focus()
              .insertContentAt({ from: mod.from, to: mod.to }, mod.newText)
              .run();
          }
          setAiOutput('Changes applied successfully.');
        } else if (data.type === 'replacement' && data.modifiedContent) {
          try {
            // First, convert the markdown content to HTML
            const htmlContent = marked(data.modifiedContent);

            // Update the editor content with the HTML
            editor.commands.setContent(htmlContent);
            
            // Store the successful update in state
            setAiOutput('Document updated successfully.');
          } catch (error) {
            console.error('Error updating document content:', error);
            setAiOutput('Error updating document content');
          }
        } else {
          setAiOutput('No changes were made to the document.');
        }
        setUserInput('');
        setSelectedTexts([]); // Clear selections after applying changes
      }
    } catch (error: any) {
      console.error('Error generating AI content:', error);
      setAiOutput(`Error: ${error.message}`);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleUserInputKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      generateAIContent();
    }
  };

  const addSelectionToChat = () => {
    if (!editor) return;

    const { from, to } = editor.state.selection;
    const selectedText = editor.state.doc.textBetween(from, to, "\\n");
    
    if (selectedText) {
      // Get the current file name from the selected document
      const currentDoc = documents.find(d => d.id === selectedDoc);
      const fileName = currentDoc?.title || 'Untitled';

      // Add selection to the array with file name
      setSelectedTexts(prev => [...prev, { 
        text: selectedText, 
        from, 
        to,
        fileName 
      }]);
      setIsChatOpen(true);
      setShowSelectionToolbar(false);
    }
  };

  // Add removeSelection function
  const removeSelection = (index: number) => {
    setSelectedTexts(prev => prev.filter((_, i) => i !== index));
  };

  // Define components for ReactMarkdown with proper types
  const markdownComponents = {
    code(props: { children: string; className?: string }) {
      const match = /language-(\\w+)/.exec(props.className || '');
      return match ? (
        <div className="relative group">
          <pre className="bg-gray-800 text-white p-3 rounded overflow-x-auto text-xs my-2">
            <code {...props}>
              {String(props.children).replace(/\\n$/, '')}
            </code>
          </pre>
          <button
            onClick={() => navigator.clipboard.writeText(String(props.children).replace(/\\n$/, ''))}
            className="absolute top-1 right-1 p-1 bg-gray-600 text-white rounded opacity-0 group-hover:opacity-100 transition-opacity text-xs"
          >
            Copy
          </button>
        </div>
      ) : (
        <code {...props}>
          {props.children}
        </code>
      );
    },
  };

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-white">
        <div className="text-gray-600">Loading...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-screen items-center justify-center bg-white">
        <div className="text-red-600">{error}</div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-white text-gray-900">
      {/* Left Sidebar */}
      <div
        className={`bg-white shadow-md transition-all duration-300 ease-in-out flex flex-col ${
          isSidebarOpen ? 'w-64' : 'w-0 overflow-hidden'
        }`}
      >
        {/* Sidebar Header */}
        <div className="p-4 flex justify-between items-center border-b border-gray-200 h-16 flex-shrink-0">
          <span className="font-semibold text-lg">Documents</span>
          <button
            onClick={createNewDocument}
            className="p-1 text-gray-500 hover:text-gray-900 hover:bg-gray-100 rounded"
            title="New Document"
          >
            <PlusIcon className="h-5 w-5" />
          </button>
        </div>

        {/* Document List */}
        <div className="flex-grow overflow-y-auto p-2 space-y-1">
          {isLoading && <div className="p-2 text-gray-500">Loading...</div>}
          {error && <div className="p-2 text-red-500">{error}</div>}
          {!isLoading && !error && documents.length === 0 && (
            <div className="p-2 text-gray-500">No documents yet.</div>
          )}
          {!isLoading &&
            !error &&
            documents.map((doc) => (
              <div
                key={doc.id}
                onClick={() => handleDocumentSelect(doc.id)}
                className={`p-2 rounded cursor-pointer group flex justify-between items-center ${
                  selectedDoc === doc.id
                    ? 'bg-indigo-100 text-indigo-700'
                    : 'hover:bg-gray-100'
                }`}
              >
                {editingTitleId === doc.id ? (
                   <input
                    type="text"
                    value={editingTitle}
                    onChange={(e) => setEditingTitle(e.target.value)}
                    onKeyDown={(e) => handleTitleKeyDown(e, doc)}
                    onBlur={() => saveTitle(doc)}
                    className="flex-grow bg-transparent border border-indigo-300 rounded px-1 py-0.5 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    autoFocus
                    onClick={(e) => e.stopPropagation()}
                  />
                ) : (
                  <span 
                    className="flex-grow truncate text-sm pr-2"
                    onDoubleClick={(e) => startEditingTitle(doc, e)}
                    title={doc.title}
                  >
                    {doc.title}
                  </span>
                )}
                <span className="text-xs text-gray-400 group-hover:text-gray-500">
                  {new Date(doc.lastModified).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
                 <button 
                    onClick={(e) => startEditingTitle(doc, e)}
                    className="ml-2 p-0.5 text-gray-400 hover:text-gray-700 opacity-0 group-hover:opacity-100 transition-opacity"
                    title="Edit Title"
                  >
                    <PencilIcon className="h-3 w-3"/>
                 </button>
              </div>
            ))}
        </div>

         {/* Sidebar Footer Actions */}
        {selectedDoc && (
          <div className="p-2 border-t border-gray-200 flex-shrink-0 space-y-1">
            <button onClick={duplicateDocument} className="w-full flex items-center text-left p-1.5 text-sm text-gray-600 hover:bg-gray-100 rounded">
              <DocumentDuplicateIcon className="h-4 w-4 mr-2" /> Duplicate
            </button>
            <button onClick={publishDocument} className="w-full flex items-center text-left p-1.5 text-sm text-gray-600 hover:bg-gray-100 rounded">
              <LinkIcon className="h-4 w-4 mr-2" /> {documents.find(d => d.id === selectedDoc)?.status === 'Published' ? 'Unpublish' : 'Publish'}
            </button>
            <button onClick={toggleHistory} className="w-full flex items-center text-left p-1.5 text-sm text-gray-600 hover:bg-gray-100 rounded">
              <ClockIcon className="h-4 w-4 mr-2" /> History
            </button>
            <button onClick={deleteDocument} className="w-full flex items-center text-left p-1.5 text-sm text-red-600 hover:bg-red-50 rounded">
              <TrashIcon className="h-4 w-4 mr-2" /> Delete
            </button>
          </div>
        )}
      </div>

      {/* Main Content Area */}
      <div className="flex-grow flex flex-col overflow-hidden bg-white">
         {/* Header Bar */}
        <div className="bg-white shadow-sm h-16 flex items-center justify-between px-4 flex-shrink-0 border-b border-gray-200">
           {/* Left side: Toggle Sidebar Button */}
           <button
            onClick={() => setIsSidebarOpen(!isSidebarOpen)}
            className="p-2 text-gray-500 hover:text-gray-900 hover:bg-gray-100 rounded"
          >
            {isSidebarOpen ? <ChevronLeftIcon className="h-5 w-5" /> : <Bars3Icon className="h-5 w-5" />}
          </button>

          {/* Center: Document Title/Info (Optional) */}
          <div className="flex-grow text-center">
            {/* {selectedDoc && documents.find(d => d.id === selectedDoc)?.title} */}
          </div>

          {/* Right side: Toolbar / Actions */}
          <div className="flex items-center space-x-2">
             {/* Mode Toggle - Now shows current mode but is not clickable */}
            <div className="flex items-center space-x-2 mr-4">
              <div className={`px-3 py-1 rounded ${
                mode === 'ask' 
                  ? 'bg-indigo-100 text-indigo-600' 
                  : 'text-gray-500'
              }`}>
                {mode === 'ask' ? 'Ask Mode' : 'Agent Mode'}
              </div>
            </div>
             {/* Formatting Buttons (Example) */}
            {editor && (
                <>
                <button onClick={() => editor.chain().focus().toggleBold().run()} className={`p-1 rounded ${editor.isActive('bold') ? 'bg-gray-200' : 'hover:bg-gray-100'}`} title="Bold"><BoldIcon className="h-5 w-5"/></button>
                <button onClick={() => editor.chain().focus().toggleItalic().run()} className={`p-1 rounded ${editor.isActive('italic') ? 'bg-gray-200' : 'hover:bg-gray-100'}`} title="Italic"><ItalicIcon className="h-5 w-5"/></button>
                <button onClick={() => editor.chain().focus().toggleUnderline().run()} className={`p-1 rounded ${editor.isActive('underline') ? 'bg-gray-200' : 'hover:bg-gray-100'}`} title="Underline"><UnderlineIcon className="h-5 w-5"/></button>
                <button onClick={() => editor.chain().focus().toggleCodeBlock().run()} className={`p-1 rounded ${editor.isActive('codeBlock') ? 'bg-gray-200' : 'hover:bg-gray-100'}`} title="Code Block"><CodeBracketIcon className="h-5 w-5"/></button>
                 {/* Add more Tiptap controls here */}
                </>
            )}
            {/* Toggle Chat Button */}
             <button
              onClick={toggleChat}
              className={`p-2 rounded ${isChatOpen ? 'bg-indigo-100 text-indigo-600' : 'text-gray-500 hover:text-gray-900 hover:bg-gray-100'}`}
              title="Toggle Chat"
            >
              <ChatBubbleLeftIcon className="h-5 w-5" />
            </button>
          </div>
        </div>

         {/* Editor Area */}
         <div className="flex-grow overflow-y-auto">
           {children}
         </div>
      </div>

      {/* Floating Selection Toolbar */}
      {showSelectionToolbar && (
        <div
          ref={selectionToolbarRef}
          style={{
            position: 'fixed',
            top: `${selectionPosition.top}px`,
            left: `${selectionPosition.left}px`,
            transform: 'translate(-50%, -100%)',
            zIndex: 50,
          }}
          className="bg-white rounded-lg shadow-lg border border-gray-200 px-2 py-1 flex items-center space-x-1"
        >
          <button
            onClick={addSelectionToChat}
            className="flex items-center space-x-1 px-2 py-1 text-sm text-gray-700 hover:bg-gray-100 rounded"
          >
            <PlusCircleIcon className="h-4 w-4" />
            <span>Add to Chat</span>
          </button>
        </div>
      )}

      {/* Right Chat Sidebar */}
      <div
        className={`bg-gray-50 border-l border-gray-200 transition-all duration-300 ease-in-out flex flex-col ${
          isChatOpen ? 'w-80' : 'w-0 overflow-hidden'
        }`}
      >
        {/* Chat Header */}
        <div className="p-4 flex items-center justify-between border-b border-gray-200 h-16 flex-shrink-0">
          <div className="flex items-center space-x-3">
            <span className="font-semibold text-lg">AI Chat</span>
            {/* Mode Toggle Switch */}
            <div className="flex items-center bg-gray-100 rounded-lg p-0.5">
              <button
                onClick={() => setMode('ask')}
                className={`px-2 py-1 text-xs rounded-md transition-colors ${
                  mode === 'ask'
                    ? 'bg-white text-indigo-600 shadow-sm'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                Ask
              </button>
              <button
                onClick={() => setMode('agent')}
                className={`px-2 py-1 text-xs rounded-md transition-colors ${
                  mode === 'agent'
                    ? 'bg-white text-indigo-600 shadow-sm'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                Agent
              </button>
            </div>
          </div>
          <button
            onClick={toggleChat}
            className="p-1 text-gray-500 hover:text-gray-900 hover:bg-gray-100 rounded"
            title="Close Chat"
          >
            <ChevronRightIcon className="h-5 w-5" />
          </button>
        </div>

        {/* Chat Output Area */}
        <div className="flex-grow overflow-y-auto p-4 space-y-4">
          {/* Mode Description */}
          <div className="text-xs text-gray-500 italic mb-2">
            {mode === 'ask' 
              ? "Ask questions and get answers without modifying the document"
              : "Make changes to the document using AI assistance"
            }
          </div>
          
          {/* Display AI Output */}
          {aiOutput && (
            <div className="p-3 bg-white rounded shadow-sm text-sm">
              <ReactMarkdown components={markdownComponents}>
                {aiOutput}
              </ReactMarkdown>
            </div>
          )}
          {isGenerating && (
            <div className="p-3 bg-white rounded shadow-sm text-sm text-gray-500">
              Thinking...
            </div>
          )}
        </div>

        {/* Chat Input Area */}
        <div className="p-4 border-t border-gray-200 flex-shrink-0">
          <div className="relative">
            {/* Selected Text Chips */}
            {selectedTexts.length > 0 && (
              <div className="flex flex-wrap gap-2 p-2 border-b border-gray-200 mb-2">
                {selectedTexts.map((selection, index) => (
                  <div
                    key={index}
                    className="flex items-center gap-1.5 bg-gray-100 text-gray-700 rounded-md px-2 py-1 text-xs font-mono"
                  >
                    <span className="text-gray-500">{selection.fileName}</span>
                    <span className="text-gray-400">(</span>
                    <span>{selection.from}-{selection.to}</span>
                    <span className="text-gray-400">)</span>
                    <button
                      onClick={() => removeSelection(index)}
                      className="ml-1 hover:text-gray-900 focus:outline-none"
                      aria-label="Remove selection"
                    >
                      <XMarkIcon className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <textarea
              value={userInput}
              onChange={(e) => setUserInput(e.target.value)}
              onKeyDown={handleUserInputKeyDown}
              placeholder={
                mode === 'ask'
                  ? "Ask me anything..."
                  : selectedTexts.length > 0
                  ? "What would you like to do with the selected text?"
                  : "Ask AI to edit..."
              }
              className="w-full p-2 pr-10 border border-gray-300 rounded resize-none focus:outline-none focus:ring-1 focus:ring-indigo-500 text-sm"
              rows={3}
              disabled={isGenerating || (mode === 'agent' && !editor)}
            />
            <button
              onClick={generateAIContent}
              disabled={isGenerating || !userInput.trim() || (mode === 'agent' && !editor)}
              className="absolute bottom-2 right-2 p-1 bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-50"
              title="Send Request"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
                <path d="M3.105 3.105a.75.75 0 0 1 .957-.168l13.3 6.65a.75.75 0 0 1 0 1.33l-13.3 6.65a.75.75 0 0 1-1.125-.957l2.43-4.86a.75.75 0 0 0 0-.684l-2.43-4.86a.75.75 0 0 1 .168-.957Z" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Layout; 