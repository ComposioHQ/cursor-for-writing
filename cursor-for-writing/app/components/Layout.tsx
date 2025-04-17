import { FC, ReactNode, useState, useEffect, KeyboardEvent as ReactKeyboardEvent, useRef } from 'react';
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
  VariableIcon,
  ArrowDownTrayIcon,
} from '@heroicons/react/24/outline';
import { ChevronDownIcon } from '@heroicons/react/20/solid';
import { BlogPost, getAllBlogPosts, saveBlogPost, deleteBlogPost } from '../utils/fileOperations';
import { Editor } from '@tiptap/react';
import { openai } from '@ai-sdk/openai';
import { VercelAIToolSet } from 'composio-core';
import { generateText } from 'ai';
import { marked } from 'marked';
import hljs from 'highlight.js';
import 'highlight.js/styles/github-dark.css';
import ReactMarkdown from 'react-markdown';
import { Components } from 'react-markdown';

// Add this line to read the environment variable
const isLocalEnv = process.env.NEXT_PUBLIC_LOCAL_ENV === 'True';

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
  const [currentFont, setCurrentFont] = useState<string>('Arial');
  const [composioApiKey, setComposioApiKey] = useState<string | null>(null);
  const [showComposioInput, setShowComposioInput] = useState(false);
  const [composioApiKeyInput, setComposioApiKeyInput] = useState('');
  const [openaiApiKey, setOpenaiApiKey] = useState<string | null>(null);
  const [showOpenaiInput, setShowOpenaiInput] = useState(false);
  const [openaiApiKeyInput, setOpenaiApiKeyInput] = useState('');
  const chatInputRef = useRef<HTMLDivElement>(null);
  // Add state for tool mention dropdown
  const [showToolDropdown, setShowToolDropdown] = useState(false);
  const [dropdownPosition, setDropdownPosition] = useState({ top: 0, left: 0 });
  const [toolOptions, setToolOptions] = useState<string[]>([]);
  // Add ref for tools dropdown
  const toolsDropdownRef = useRef<HTMLDivElement>(null);
  // Add state for text style dropdown
  const [showTextStyleDropdown, setShowTextStyleDropdown] = useState(false);
  const textStyleDropdownRef = useRef<HTMLDivElement>(null);

  const availableFonts = ['Arial', 'Georgia', 'Times New Roman', 'Courier New', 'Verdana', 'Comic Sans MS'];

  // Define available tools that can be mentioned with @ symbol
  const availableTools = [
    { name: 'composio_search', description: 'Search the internet' },
    { name: 'googledocs', description: 'Interact with Google Docs' },
    { name: 'gmail', description: 'Access Gmail' },
    { name: 'notion', description: 'Work with Notion' },
    { name: 'linkedin', description: 'Create Posts on Linkedin'},
    { name: 'twitter', description: 'Create Posts on Twitter'},
    { name: 'typefully', description: 'Create Drafts on Typefully'}
  ];

  useEffect(() => {
    // Conditionally load documents only if in local env
    if (isLocalEnv) {
      loadDocuments();
    } else {
      // If not local env, set loading to false and clear documents
      setIsLoading(false);
      setDocuments([]);
      setSelectedDoc(null);
      onDocumentSelect?.(null); // Notify parent component
    }
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
      // Add handler for tools dropdown
      if (
        toolsDropdownRef.current && 
        !toolsDropdownRef.current.contains(event.target as Node) &&
        chatInputRef.current &&
        !chatInputRef.current.contains(event.target as Node)
      ) {
        setShowToolDropdown(false);
      }
      
      // Add handler for text style dropdown
      if (
        textStyleDropdownRef.current &&
        !textStyleDropdownRef.current.contains(event.target as Node)
      ) {
        setShowTextStyleDropdown(false);
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
    // This function should only be callable if isLocalEnv is true, ensured by conditional button rendering
    try {
      setError(null);
      const newDoc: BlogPost = {
        id: `blog${Date.now()}`,
        title: 'Untitled',
        content: '',
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
    // This function should only be callable if isLocalEnv is true, ensured by conditional button rendering
    event.stopPropagation();
    setEditingTitleId(doc.id);
    setEditingTitle(doc.title);
  };

  const handleTitleKeyDown = async (event: React.KeyboardEvent<HTMLInputElement>, doc: BlogPost) => {
    if (event.key === 'Enter') {
      await saveTitle(doc);
    } else if (event.key === 'Escape') {
      setEditingTitleId(null);
    }
  };

  const saveTitle = async (doc: BlogPost) => {
    // This function relies on editingTitleId being set, which happens via startEditingTitle
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
    // This function should only be callable if isLocalEnv is true, ensured by conditional button rendering
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

      // Call the actual deletion function from fileOperations
      await deleteBlogPost(selectedDoc);
    } catch (error) {
      console.error('Failed to delete document:', error);
      // Reload documents to ensure consistency if deletion fails
      await loadDocuments(); // Ensure reload happens even on error
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

  // Function to create highlighted HTML from text
  const createHighlightedHtml = (text: string): string => {
    const mentionRegex = /(@[a-zA-Z0-9_]+)/g;
    // Escape HTML characters in the text first
    const escapedText = text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\n/g, "<br>"); // Preserve line breaks

    return escapedText.replace(mentionRegex, '<span class="tool-mention">$1</span>');
  };

  // Function to handle input in the contentEditable div - simplified version
  const handleChatInput = (event: React.FormEvent<HTMLDivElement>) => {
    const target = event.currentTarget as HTMLDivElement;
    const text = target.innerText; // Get plain text
    setUserInput(text); // Update plain text state

    // Simplified approach for @ detection
    if (text.includes('@')) {
      const atSymbolIndex = text.lastIndexOf('@');
      const cursorPosition = getCursorPosition(target);
      
      // Only show dropdown if cursor is after the @ symbol
      if (cursorPosition && cursorPosition > atSymbolIndex) {
        const query = text.substring(atSymbolIndex + 1, cursorPosition).toLowerCase();
        
        // Filter tools based on query
        const filtered = availableTools
          .filter(tool => tool.name.toLowerCase().includes(query))
          .map(tool => tool.name);
        
        if (filtered.length > 0) {
          setToolOptions(filtered);
          setShowToolDropdown(true);
        } else {
          setShowToolDropdown(false);
        }
      } else {
        setShowToolDropdown(false);
      }
    } else {
      setShowToolDropdown(false);
    }
  };

  // Function to insert tool name when selected from dropdown
  const insertToolMention = (toolName: string) => {
    if (!chatInputRef.current) return;
    
    const text = userInput;
    const atSymbolIndex = text.lastIndexOf('@');
    if (atSymbolIndex === -1) return;
    
    const cursorPosition = getCursorPosition(chatInputRef.current);
    if (cursorPosition === null) return;
    
    // This is the part before the @ symbol
    const beforeAt = text.substring(0, atSymbolIndex);
    
    // Find where the partial tool text ends
    // We need to detect word boundaries to find where our partial typed tool name ends
    const textAfterAt = text.substring(atSymbolIndex + 1); // Get everything after @
    
    // Extract the partial tool name (the word starting at @ until a space or end)
    const partialToolMatch = textAfterAt.match(/^(\w+)/);
    const partialToolLength = partialToolMatch ? partialToolMatch[0].length : 0;
    
    // Get the text after the partial tool name (skip the @ and the partial tool)
    const afterPartialTool = text.substring(atSymbolIndex + 1 + partialToolLength);
    
    // Create the new text with just one @ followed by the complete tool name
    const newText = `${beforeAt}@${toolName} ${afterPartialTool}`;
    
    // Set the new text and close the dropdown
    setUserInput(newText);
    setShowToolDropdown(false);
    
    // Focus back on input after a short delay
    setTimeout(() => {
      if (chatInputRef.current) {
        chatInputRef.current.focus();
        
        // Calculate position after the inserted tool name plus a space
        const newPosition = atSymbolIndex + toolName.length + 2; // +1 for @ and +1 for space
        
        try {
          const sel = window.getSelection();
          if (!sel) return;
          
          // Try to set cursor position using DOM Range
          const range = document.createRange();
          
          // Find the right node and position
          let currentNode = chatInputRef.current.firstChild;
          let currentPos = 0;
          
          // Simple text node search
          if (currentNode && currentNode.nodeType === Node.TEXT_NODE) {
            // If we have a single text node, it's simple
            range.setStart(currentNode, Math.min(newPosition, currentNode.textContent?.length || 0));
            range.collapse(true);
            sel.removeAllRanges();
            sel.addRange(range);
          } else {
            // If complex DOM, use our helper function
            const textNode = findTextNodeAtPosition(chatInputRef.current, newPosition);
            if (textNode) {
              const offset = newPosition - getTextNodePosition(chatInputRef.current, textNode);
              range.setStart(textNode, Math.min(offset, textNode.textContent?.length || 0));
              range.collapse(true);
              sel.removeAllRanges();
              sel.addRange(range);
            }
          }
        } catch (err) {
          console.log('Error setting cursor position:', err);
        }
      }
    }, 10);
  };

  // Helper function to find a text node at a given position
  const findTextNodeAtPosition = (element: Node, position: number): Node | null => {
    let currentPosition = 0;
    
    const findNode = (node: Node): Node | null => {
      if (node.nodeType === Node.TEXT_NODE) {
        const nodeLength = node.textContent?.length || 0;
        if (currentPosition <= position && currentPosition + nodeLength >= position) {
          return node;
        }
        currentPosition += nodeLength;
      } else {
        for (let i = 0; i < node.childNodes.length; i++) {
          const foundNode = findNode(node.childNodes[i]);
          if (foundNode) return foundNode;
        }
      }
      return null;
    };
    
    return findNode(element);
  };

  // Helper function to get text node position
  const getTextNodePosition = (rootNode: Node, targetNode: Node): number => {
    let position = 0;
    
    const traverse = (node: Node) => {
      if (node === targetNode) return true;
      
      if (node.nodeType === Node.TEXT_NODE) {
        position += node.textContent?.length || 0;
      }
      
      for (let i = 0; i < node.childNodes.length; i++) {
        if (traverse(node.childNodes[i])) return true;
      }
      
      return false;
    };
    
    traverse(rootNode);
    return position;
  };

  // Get current cursor position (basic implementation)
  const getCursorPosition = (element: HTMLDivElement): number | null => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return null;
    
    const range = selection.getRangeAt(0);
    const preCaretRange = range.cloneRange();
    preCaretRange.selectNodeContents(element);
    preCaretRange.setEnd(range.startContainer, range.startOffset);
    return preCaretRange.toString().length;
  };
  
  // Use useEffect to update innerHTML and restore cursor when userInput changes
  useEffect(() => {
    if (chatInputRef.current) {
      const currentPosition = getCursorPosition(chatInputRef.current);
      const newHtml = createHighlightedHtml(userInput);
      // Only update if HTML is different to avoid unnecessary cursor jumps
      if (chatInputRef.current.innerHTML !== newHtml) {
          chatInputRef.current.innerHTML = newHtml;
          restoreCursorPosition(chatInputRef.current, currentPosition);
      }
    }
  }, [userInput]);

  // Add back the restoreCursorPosition function
  const restoreCursorPosition = (element: HTMLDivElement, savedPosition: number | null) => {
    if (savedPosition === null || !document.createRange || !window.getSelection) return;
    const range = document.createRange();
    const sel = window.getSelection();
    
    let charCount = 0;
    let foundStart = false;
    const traverseNodes = (node: Node) => {
      if (foundStart) return;
      if (node.nodeType === Node.TEXT_NODE) {
        const nextCharCount = charCount + (node.textContent?.length || 0);
        if (savedPosition <= nextCharCount) {
          range.setStart(node, savedPosition - charCount);
          range.collapse(true);
          foundStart = true;
        }
        charCount = nextCharCount;
      } else {
        for (let i = 0; i < node.childNodes.length && !foundStart; i++) {
          traverseNodes(node.childNodes[i]);
        }
      }
    };

    traverseNodes(element);

    if (sel && foundStart) {
      sel.removeAllRanges();
      sel.addRange(range);
    }
  };

  const generateAIContent = async () => {
    if (!userInput.trim() || isGenerating) return;
    
    if (mode === 'agent' && !editor) {
      console.error("Agent mode selected but editor is not available.");
      return;
    }

    setIsGenerating(true);

    // Check if Composio API key is set before proceeding
    if (!composioApiKey) {
      setAiOutput('Please set your Composio API key in the chat settings before using the AI chat feature.');
      setIsGenerating(false);
      return;
    }

    try {
      // Get the current content from the editor for both modes
      const currentContent = editor ? editor.getHTML() : editorContent;
      
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
          currentContent, // Pass the current editor content for both modes
          selections: selectedTextsData,
          mode,
          composioApiKey
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Failed to parse error response' }));
        console.error('API Error Response:', errorData);
        throw new Error(errorData.error || 'Failed to generate response');
      }

      const data = await response.json();
      // console.log("API Response Data:", data); // Ensure this one is definitely showing

      if (data.type === 'chat') {
        // console.log("Handling as chat response");
        setAiOutput(data.chatResponse);
        setUserInput('');
      } else if (mode === 'agent' && editor) {
        // Clear previous diffs before adding new ones
        editor.commands.clearDiffs(); 

        // Handle document modifications by adding diffs
        if (data.type === 'modification' && data.modifications) {
          const sortedMods = [...data.modifications].sort((a, b) => a.from - a.from); // Sort by starting position
          
          for (const mod of sortedMods) {
             // Use the addDiff command instead of direct insertion
            editor.commands.addDiff({ 
              from: mod.from, 
              to: mod.to, 
              newText: mod.newText 
            });
          }
          setAiOutput('Suggested changes are highlighted. Press Tab near a change to accept it.');
        } else if (data.type === 'replacement' && data.modifiedContent) {
          // Handle full replacement - This might be complex with diffs. 
          // A better approach might be to calculate a diff between old and new content.
          editor.commands.clearDiffs();
          try {
            // --- BEGIN ADDED LOGGING ---
            console.log('AI Markdown Response:', data.modifiedContent);
            const htmlContent = marked(data.modifiedContent);
            console.log('Converted HTML for setContent:', htmlContent);
            // --- END ADDED LOGGING ---
            
            // Explicitly clear existing content before setting new content
            editor.commands.clearContent(true);
            
            editor.commands.setContent(htmlContent);
            setAiOutput('Document updated successfully (full replacement).');
          } catch (error) {
            // --- BEGIN IMPROVED ERROR HANDLING ---
            console.error('Error processing AI replacement content:', error);
            // Provide more details in the chat output
            const errorMessage = error instanceof Error ? error.message : String(error);
            setAiOutput(`Error updating document: ${errorMessage}`);
            // Optionally log the content that caused the error
            console.error('Markdown causing error:', data.modifiedContent);
            // --- END IMPROVED ERROR HANDLING ---
          }
        } else {
          editor.commands.clearDiffs(); // Ensure diffs are cleared if no changes
          setAiOutput('No changes were suggested by the AI.');
        }
        setUserInput('');
        setSelectedTexts([]); // Clear selections after processing AI response
      }
    } catch (error: any) {
      console.error('Error in generateAIContent:', error);
      setAiOutput(`Error: ${error.message}`);
      if (editor) editor.commands.clearDiffs(); // Clear diffs on error too
    } finally {
      setIsGenerating(false);
    }
  };

  const handleUserInputKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
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

  // Function to apply a random font
  const applyRandomFont = () => {
    if (!editor) return;

    const randomIndex = Math.floor(Math.random() * availableFonts.length);
    const newFont = availableFonts[randomIndex];

    // Select all content and apply font family without explicit focus
    editor.chain().selectAll().setFontFamily(newFont).run();
    setCurrentFont(newFont); // Update the displayed font name
  };

  // Add function to export content as MDX
  const exportAsMdx = () => {
    if (!selectedDoc) return;
    const doc = documents.find(d => d.id === selectedDoc);
    if (!doc) return;

    const markdownContent = editorContent; // Use the editor content directly

    const blob = new Blob([markdownContent], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'cursor_for_writing.md'; // Keep changed filename
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // --- Composio API Key Management --- (No localStorage interaction)
  const handleSaveComposioKey = () => {
    if (composioApiKeyInput.trim()) {
      setComposioApiKey(composioApiKeyInput.trim());
      setShowComposioInput(false);
      setAiOutput('Composio API key set for this session.'); // Updated feedback
    } else {
      setAiOutput('API key cannot be empty.');
    }
  };

  const handleRemoveComposioKey = () => {
    setComposioApiKey(null);
    setComposioApiKeyInput('');
    setShowComposioInput(false);
    setAiOutput('Composio API key removed for this session.'); // Updated feedback
  };
  // --- End Composio API Key Management ---

  // --- OpenAI API Key Management (UI Only) ---
  const handleSaveOpenaiKey = () => {
    if (openaiApiKeyInput.trim()) {
      setOpenaiApiKey(openaiApiKeyInput.trim()); // Store locally for UI feedback
      setShowOpenaiInput(false);
      setAiOutput('OpenAI API key status updated for this session.'); // Feedback reflects UI state change
    } else {
      setAiOutput('API key cannot be empty.');
    }
  };

  const handleRemoveOpenaiKey = () => {
    setOpenaiApiKey(null);
    setOpenaiApiKeyInput('');
    setShowOpenaiInput(false);
    setAiOutput('OpenAI API key status cleared for this session.'); // Feedback reflects UI state change
  };
  // --- End OpenAI API Key Management ---

  // Add function to get current text style label
  const getCurrentTextStyle = (): string => {
    if (!editor) return 'Paragraph';
    
    if (editor.isActive('heading', { level: 1 })) return 'Heading 1';
    if (editor.isActive('heading', { level: 2 })) return 'Heading 2';
    if (editor.isActive('heading', { level: 3 })) return 'Heading 3';
    if (editor.isActive('heading', { level: 4 })) return 'Heading 4';
    if (editor.isActive('heading', { level: 5 })) return 'Heading 5';
    if (editor.isActive('heading', { level: 6 })) return 'Heading 6';
    if (editor.isActive('paragraph')) return 'Paragraph';
    if (editor.isActive('bulletList')) return 'Bullet List';
    if (editor.isActive('orderedList')) return 'Numbered List';
    if (editor.isActive('blockquote')) return 'Quote';
    if (editor.isActive('codeBlock')) return 'Code Block';
    
    return 'Paragraph';
  };

  // Define text styles
  const textStyles = [
    { label: 'Heading 1', action: () => editor?.chain().focus().toggleHeading({ level: 1 }).run() },
    { label: 'Heading 2', action: () => editor?.chain().focus().toggleHeading({ level: 2 }).run() },
    { label: 'Heading 3', action: () => editor?.chain().focus().toggleHeading({ level: 3 }).run() },
    { label: 'Heading 4', action: () => editor?.chain().focus().toggleHeading({ level: 4 }).run() },
    { label: 'Heading 5', action: () => editor?.chain().focus().toggleHeading({ level: 5 }).run() },
    { label: 'Heading 6', action: () => editor?.chain().focus().toggleHeading({ level: 6 }).run() },
    { label: 'Paragraph', action: () => editor?.chain().focus().setParagraph().run() },
    { label: 'Bullet List', action: () => editor?.chain().focus().toggleBulletList().run() },
    { label: 'Numbered List', action: () => editor?.chain().focus().toggleOrderedList().run() },
    { label: 'Quote', action: () => editor?.chain().focus().toggleBlockquote().run() },
    { label: 'Code Block', action: () => editor?.chain().focus().toggleCodeBlock().run() },
  ];

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
      {/* Sidebar - Conditionally render with ORIGINAL styling */}
      {isLocalEnv && (
        <div
          // Restore original sidebar styling + conditional width
          className={`bg-white shadow-md transition-all duration-300 ease-in-out flex flex-col ${
            isSidebarOpen ? 'w-64' : 'w-0 overflow-hidden' // Use original collapsed state
          }`}
        >
          {/* Sidebar Header - Restore original styling */}
          <div className="p-4 flex justify-between items-center border-b border-gray-200 h-16 flex-shrink-0">
            <span className="font-semibold text-lg">Documents</span>
            {/* Keep conditional rendering for the button */}
            {isLocalEnv && (
              <button
                onClick={createNewDocument}
                // Restore original button styling
                className="p-1 text-gray-500 hover:text-gray-900 hover:bg-gray-100 rounded"
                title="New Document"
              >
                {/* Restore original icon size */}
                <PlusIcon className="h-5 w-5" /> 
              </button>
            )}
          </div>

          {/* Document List - Restore original styling */} 
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
                   // Restore original item styling
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
                      // Restore original input styling
                      className="flex-grow bg-transparent border border-indigo-300 rounded px-1 py-0.5 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500"
                      autoFocus
                      onClick={(e) => e.stopPropagation()}
                    />
                  ) : (
                    <span 
                      // Restore original title styling
                      className="flex-grow truncate text-sm pr-2"
                      onDoubleClick={(e) => isLocalEnv && startEditingTitle(doc, e)} // Conditionally allow double click edit
                      title={doc.title}
                    >
                      {doc.title}
                    </span>
                  )}
                  {/* Restore original time display */}
                  <span className="text-xs text-gray-400 group-hover:text-gray-500">
                    {new Date(doc.lastModified).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                   {/* Conditionally render original edit button */}
                   {isLocalEnv && (
                     <button 
                       onClick={(e) => startEditingTitle(doc, e)}
                       // Restore original edit button styling
                       className="ml-2 p-0.5 text-gray-400 hover:text-gray-700 opacity-0 group-hover:opacity-100 transition-opacity"
                       title="Edit Title"
                       disabled={editingTitleId === doc.id} // Keep disabled logic
                     >
                       {/* Restore original icon size */}
                       <PencilIcon className="h-3 w-3"/>
                    </button>
                   )}
                </div>
              ))}
          </div>

          {/* Sidebar Footer Actions - Conditionally render buttons inside */} 
          {selectedDoc && (
            <div className="p-2 border-t border-gray-200 flex-shrink-0 space-y-1">
              {/* Conditionally render Duplicate button with original style */} 
              {isLocalEnv && (
                <button onClick={duplicateDocument} className="w-full flex items-center text-left p-1.5 text-sm text-gray-600 hover:bg-gray-100 rounded">
                  <DocumentDuplicateIcon className="h-4 w-4 mr-2" /> Duplicate
                </button>
              )}
              {/* Keep Publish button as is (or make conditional if required) */}
              <button onClick={publishDocument} className="w-full flex items-center text-left p-1.5 text-sm text-gray-600 hover:bg-gray-100 rounded">
                <LinkIcon className="h-4 w-4 mr-2" /> {documents.find(d => d.id === selectedDoc)?.status === 'Published' ? 'Unpublish' : 'Publish'}
              </button>
              {/* Keep History button */}
              <button onClick={toggleHistory} className="w-full flex items-center text-left p-1.5 text-sm text-gray-600 hover:bg-gray-100 rounded">
                <ClockIcon className="h-4 w-4 mr-2" /> History
              </button>
              {/* Conditionally render Delete button with original style */}
              {isLocalEnv && (
                <button onClick={deleteDocument} className="w-full flex items-center text-left p-1.5 text-sm text-red-600 hover:bg-red-50 rounded">
                  <TrashIcon className="h-4 w-4 mr-2" /> Delete
                </button>
              )}
            </div>
          )}
        </div>
      )} {/* End of conditional sidebar */} 


      {/* Main Content Area - Restore original styling */} 
      <div className="flex-grow flex flex-col overflow-hidden bg-white">
          {/* Header Bar - Restore original styling */} 
         <div className="bg-white shadow-sm h-16 flex items-center justify-between px-4 flex-shrink-0 border-b border-gray-200">
            {/* Left side: Toggle Sidebar Button - Conditionally render */}
            {isLocalEnv && (
                <button
                onClick={() => setIsSidebarOpen(!isSidebarOpen)}
                // Restore original toggle button styling
                className="p-2 text-gray-500 hover:text-gray-900 hover:bg-gray-100 rounded"
              >
                {/* Restore original icon size */}
                {isSidebarOpen ? <ChevronLeftIcon className="h-5 w-5" /> : <Bars3Icon className="h-5 w-5" />}
              </button>
            )}
            
            {/* Center: Document Title/Info (Conditional display) */}
            <div className="flex-grow text-center">
              {/* REMOVED Title display logic from here */}
            </div>

            {/* Right side: Toolbar / Actions - Restore original styling */} 
            <div className="flex items-center space-x-2">
              {/* Text Style Dropdown - Only visible if editor exists */}
              {editor && (
                <div className="relative mr-2" ref={textStyleDropdownRef}>
                  <button
                    onClick={() => setShowTextStyleDropdown(!showTextStyleDropdown)}
                    className="flex items-center space-x-1 px-2 py-1 rounded hover:bg-gray-100 border border-gray-300"
                    title="Text Style"
                  >
                    <span className="text-sm font-medium">{getCurrentTextStyle()}</span>
                    <ChevronDownIcon className="h-4 w-4" />
                  </button>
                  
                  {/* Text Style Dropdown Menu */}
                  {showTextStyleDropdown && (
                    <div 
                      className="absolute top-full left-0 mt-1 bg-white shadow-lg border border-gray-200 rounded-md w-48 z-50 max-h-80 overflow-y-auto"
                    >
                      {textStyles.map((style) => (
                        <button
                          key={style.label}
                          onClick={() => {
                            style.action();
                            setShowTextStyleDropdown(false);
                          }}
                          className={`w-full text-left px-3 py-2 text-sm hover:bg-gray-100 ${
                            editor.isActive('heading', { level: parseInt(style.label.split(' ')[1]) }) || 
                            editor.isActive(style.label.toLowerCase().replace(' ', '')) ||
                            (style.label === 'Paragraph' && editor.isActive('paragraph'))
                              ? 'bg-indigo-50 text-indigo-700'
                              : ''
                          }`}
                        >
                          {style.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
              
              {/* Mode Toggle - Always Visible */} 
             <div className="flex items-center space-x-2 mr-4">
               {/* ... Mode toggle JSX ... (Assuming it's always visible) */} 
             </div>
              {/* Formatting Buttons - Always Visible if editor exists */} 
             {editor && (
                 <>
                  <button onClick={() => editor.chain().focus().toggleBold().run()} className={`p-1 rounded ${editor.isActive('bold') ? 'bg-gray-200' : 'hover:bg-gray-100'}`} title="Bold"><BoldIcon className="h-5 w-5"/></button>
                  <button onClick={() => editor.chain().focus().toggleItalic().run()} className={`p-1 rounded ${editor.isActive('italic') ? 'bg-gray-200' : 'hover:bg-gray-100'}`} title="Italic"><ItalicIcon className="h-5 w-5"/></button>
                  <button onClick={() => editor.chain().focus().toggleUnderline().run()} className={`p-1 rounded ${editor.isActive('underline') ? 'bg-gray-200' : 'hover:bg-gray-100'}`} title="Underline"><UnderlineIcon className="h-5 w-5"/></button>
                  <button onClick={() => editor.chain().focus().toggleCodeBlock().run()} className={`p-1 rounded ${editor.isActive('codeBlock') ? 'bg-gray-200' : 'hover:bg-gray-100'}`} title="Code Block"><CodeBracketIcon className="h-5 w-5"/></button>
                 </>
             )}
              {/* Random Font Button - Always Visible */}
              <button 
                onClick={applyRandomFont}
                className={`p-1 rounded hover:bg-gray-100 flex items-center space-x-1`}
                title="Apply Random Font"
              >
                <VariableIcon className="h-5 w-5"/> 
                <span className="text-xs">({currentFont})</span>
              </button>
             
              {/* Export Button - Always Visible */} 
              <button 
                onClick={exportAsMdx}
                className={`p-1 rounded hover:bg-gray-100 text-blue-600`}
                title="Export as Markdown"
                disabled={!selectedDoc && isLocalEnv} // Disable only if local env and no doc selected
              >
                <ArrowDownTrayIcon className="h-5 w-5"/> 
              </button>

              {/* Chat Toggle Button - Always Visible */} 
              <button
                onClick={toggleChat}
                className={`p-1 rounded ${isChatOpen ? 'bg-indigo-100' : 'hover:bg-gray-100'}`}
                title="Toggle Chat"
              >
                {/* Replace Icon with Image */}
                <img src="/chat_icon.png" alt="Chat" className="h-6 w-12" />
              </button>
            </div>
         </div>

         {/* Editor Area - Always Visible */} 
         <div className="flex-grow overflow-y-auto">
           {children}
         </div>
      </div>

      {/* Keep Floating Selection Toolbar - Always Visible (conditionally shown based on selection) */} 
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

      {/* Keep Right Chat Sidebar - Always Visible (conditionally shown based on isChatOpen) */}
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
                Agent
              </button>
              <button
                onClick={() => setMode('agent')}
                className={`px-2 py-1 text-xs rounded-md transition-colors ${
                  mode === 'agent'
                    ? 'bg-white text-indigo-600 shadow-sm'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                Write
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
          {/* API Key Management Area */}
          <div className="text-xs text-gray-500 italic mb-4 p-3 bg-white rounded shadow-sm border border-gray-200 space-y-4">
            {/* Mode description */}
            {mode === 'ask' ? (
              <div>Execute agentic actions on the document.</div>
            ) : (
              <div>Write mode: Write/Make changes to the document using AI.</div>
            )}

            {/* Composio API Key Section */}
            <div className="mt-2 pt-2 border-t border-gray-100">
              <div className="flex justify-between items-center">
                <p className="mb-1 font-medium text-gray-600">Composio API Key</p>
                {composioApiKey ? (
                  <button
                    onClick={handleRemoveComposioKey}
                    className="text-red-500 hover:text-red-700 text-xs"
                  >
                    Remove
                  </button>
                ) : (
                  <button
                    onClick={() => setShowComposioInput(!showComposioInput)}
                    className="text-indigo-600 hover:text-indigo-800 text-xs"
                  >
                    {showComposioInput ? 'Cancel' : 'Set Key'}
                  </button>
                )}
              </div>
              {composioApiKey ? (
                 <p className="text-green-600 text-xs">Key is set for this session.</p>
              ) : showComposioInput ? (
                <div className="mt-1">
                  <div className="flex items-center space-x-2">
                    <input
                      type="password"
                      value={composioApiKeyInput}
                      onChange={(e) => setComposioApiKeyInput(e.target.value)}
                      placeholder="Enter Composio API Key"
                      className="flex-grow px-2 py-1 border border-gray-300 rounded text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    />
                    <button
                      onClick={handleSaveComposioKey}
                      className="px-2 py-1 bg-indigo-600 text-white rounded text-xs hover:bg-indigo-700"
                    >
                      Save
                    </button>
                  </div>
                  <p className="text-xs text-gray-400 mt-1">Ask admin for key.</p>
                </div>
              ) : (
                <p className="text-gray-400 text-xs">Required for Composio tools.</p>
              )}
            </div>
            
            {/* OpenAI API Key Section (Mirrors Composio) */}
            <div className="mt-2 pt-2 border-t border-gray-100">
              <div className="flex justify-between items-center">
                <p className="mb-1 font-medium text-gray-600">OpenAI API Key</p>
                {openaiApiKey ? (
                  <button
                    onClick={handleRemoveOpenaiKey}
                    className="text-red-500 hover:text-red-700 text-xs"
                  >
                    Remove
                  </button>
                ) : (
                  <button
                    onClick={() => setShowOpenaiInput(!showOpenaiInput)}
                    className="text-indigo-600 hover:text-indigo-800 text-xs"
                  >
                    {showOpenaiInput ? 'Cancel' : 'Set Key'}
                  </button>
                )}
              </div>
              {openaiApiKey ? (
                 <p className="text-green-600 text-xs">Key status set for this session.</p>
              ) : showOpenaiInput ? (
                <div className="mt-1">
                  <div className="flex items-center space-x-2">
                    <input
                      type="password"
                      value={openaiApiKeyInput}
                      onChange={(e) => setOpenaiApiKeyInput(e.target.value)}
                      placeholder="Enter OpenAI API Key"
                      className="flex-grow px-2 py-1 border border-gray-300 rounded text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    />
                    <button
                      onClick={handleSaveOpenaiKey}
                      className="px-2 py-1 bg-indigo-600 text-white rounded text-xs hover:bg-indigo-700"
                    >
                      Save
                    </button>
                  </div>
                  <p className="text-xs text-gray-400 mt-1">Needed for OpenAI models.</p>
                </div>
              ) : (
                 <p className="text-gray-400 text-xs">Backend uses key from environment.</p>
              )}
            </div>
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
              <span className="thinking-animation">Thinking<span className="dot-one">.</span><span className="dot-two">.</span><span className="dot-three">.</span></span>
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
            
            {/* Tool Mention Dropdown - FIXED POSITIONING */}
            {showToolDropdown && (
              <div 
                ref={toolsDropdownRef}
                className="absolute z-50 bg-white shadow-xl border-2 border-indigo-300 rounded-md overflow-hidden w-72"
                style={{ 
                  bottom: '100%',  // Position directly above the input
                  left: '0',
                  marginBottom: '8px', // Add some space between dropdown and input
                }}
              >
                <div className="px-3 py-2 text-sm font-semibold text-indigo-700 bg-indigo-50 border-b border-indigo-200 flex justify-between items-center">
                  <span>Composio Integrations</span>
                  <button 
                    onClick={() => setShowToolDropdown(false)}
                    className="text-gray-500 hover:text-gray-700"
                  >
                    <XMarkIcon className="h-4 w-4" />
                  </button>
                </div>
                <div className="max-h-60 overflow-y-auto">
                  {toolOptions.map((tool) => {
                    const toolInfo = availableTools.find(t => t.name === tool);
                    return (
                      <div 
                        key={tool}
                        className="px-4 py-3 hover:bg-indigo-50 cursor-pointer flex flex-col text-sm border-b border-gray-100"
                        onClick={() => insertToolMention(tool)}
                      >
                        <span className="font-semibold text-indigo-700">@{tool}</span>
                        {toolInfo && (
                          <span className="text-xs text-gray-600 mt-1">{toolInfo.description}</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
            
            {/* Replace textarea with contentEditable div */}
            <div
              ref={chatInputRef}
              contentEditable={!(isGenerating || (mode === 'agent' && !editor))}
              onInput={handleChatInput}
              onKeyDown={handleUserInputKeyDown}
              suppressContentEditableWarning={true}
              data-placeholder={ 
                mode === 'ask'
                  ? "Ask me anything... (Type @ for tools)"
                  : selectedTexts.length > 0
                  ? "What would you like to do with the selected text?"
                  : "Ask AI to edit..."
              }
              className="w-full p-2 pr-10 border border-gray-300 rounded resize-none focus:outline-none focus:ring-1 focus:ring-indigo-500 text-sm bg-white min-h-[68px] whitespace-pre-wrap overflow-y-auto"
              style={{ minHeight: '68px' }} 
            />
            
            {/* CSS for placeholder - updated selector */}
            <style>{`
              .tool-mention {
                background-color: #e0e7ff; 
                color: #4338ca; 
                padding: 1px 2px;
                border-radius: 3px;
                font-weight: 500;
              }
              div[contentEditable=true]:empty:before {
                content: attr(data-placeholder); /* Use data-placeholder */
                pointer-events: none;
                color: #9ca3af; 
                display: block; 
              }
              .thinking-animation .dot-one,
              .thinking-animation .dot-two,
              .thinking-animation .dot-three {
                animation: blink 1.4s infinite;
                animation-fill-mode: both;
              }
              .thinking-animation .dot-one {
                animation-delay: 0s;
              }
              .thinking-animation .dot-two {
                animation-delay: 0.2s;
              }
              .thinking-animation .dot-three {
                animation-delay: 0.4s;
              }
              @keyframes blink {
                0% { opacity: 0.2; }
                20% { opacity: 1; }
                100% { opacity: 0.2; }
              }
            `}</style>
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