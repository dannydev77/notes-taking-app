const express = require('express');
const bodyParser = require('body-parser');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');
const marked = require('marked');
const multer = require('multer');
const clipboard = require('clipboard-polyfill');

const app = express();
const PORT = 3000;

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadPath = path.join(__dirname, 'uploads');
    if (!fs.existsSync(uploadPath)) {
      fs.mkdirSync(uploadPath);
    }
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname}`);
  }
});

const upload = multer({ storage });

// Configure middleware
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));

// Set EJS as the view engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Configure marked (Markdown)
marked.setOptions({
  breaks: true,
  gfm: true
});

// Create necessary directories if they don't exist
['notes', 'uploads', 'notebooks'].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir);
  }
});

// Helper functions
const getAllNotes = (notebook = '') => {
  const notebookPath = notebook ? path.join('notebooks', notebook) : 'notes';
  if (!fs.existsSync(notebookPath)) return [];
  
  const files = fs.readdirSync(notebookPath);
  return files
    .filter(file => file.endsWith('.json'))
    .map(file => {
      const content = fs.readFileSync(path.join(notebookPath, file), 'utf8');
      return { 
        id: file.replace('.json', ''), 
        notebook: notebook || null,
        ...JSON.parse(content) 
      };
    });
};

const getAllNotebooks = () => {
  return fs.readdirSync('notebooks').filter(item => {
    return fs.statSync(path.join('notebooks', item)).isDirectory();
  });
};

const searchNotes = (query, notes) => {
  if (!query) return notes;
  return notes.filter(note => 
    note.title.toLowerCase().includes(query.toLowerCase()) ||
    note.content.toLowerCase().includes(query.toLowerCase()) ||
    (note.tags && note.tags.some(tag => tag.toLowerCase().includes(query.toLowerCase())))
  );
};

// Routes
app.get('/', (req, res) => {
  const notebook = req.query.notebook || '';
  const notes = getAllNotes(notebook);
  const categories = [...new Set(notes.flatMap(note => note.categories || []))];
  const tags = [...new Set(notes.flatMap(note => note.tags || []))];
  const notebooks = getAllNotebooks();
  
  res.render('index', { 
    notes,
    categories,
    tags,
    notebooks,
    currentNotebook: notebook,
    searchQuery: req.query.search || '',
    selectedCategory: req.query.category || '',
    selectedTag: req.query.tag || ''
  });
});

// Notebook management
app.get('/notebooks', (req, res) => {
  const notebooks = getAllNotebooks();
  res.render('notebooks', { notebooks });
});

app.post('/notebooks', (req, res) => {
  const notebookName = req.body.name.trim();
  if (notebookName) {
    const notebookPath = path.join('notebooks', notebookName);
    if (!fs.existsSync(notebookPath)) {
      fs.mkdirSync(notebookPath);
    }
  }
  res.redirect('/notebooks');
});

app.post('/notebooks/:name/delete', (req, res) => {
  const notebookPath = path.join('notebooks', req.params.name);
  if (fs.existsSync(notebookPath)) {
    fs.rmdirSync(notebookPath, { recursive: true });
  }
  res.redirect('/notebooks');
});

// Note routes
app.get('/notes/new', (req, res) => {
  const notebooks = getAllNotebooks();
  res.render('edit-note', { note: null, notebooks });
});

app.post('/notes', upload.array('attachments', 5), (req, res) => {
  const id = uuidv4();
  const notebook = req.body.notebook || '';
  const savePath = notebook ? path.join('notebooks', notebook) : 'notes';
  
  if (!fs.existsSync(savePath)) {
    fs.mkdirSync(savePath, { recursive: true });
  }
  
  const attachments = (req.files || []).map(file => ({
    name: file.originalname,
    path: `/uploads/${file.filename}`
  }));
  
  // Handle pasted images
  let content = req.body.content;
  const pastedImages = JSON.parse(req.body.pastedImages || '[]');
  pastedImages.forEach(img => {
    const imgName = `pasted-${Date.now()}.png`;
    const imgPath = path.join(__dirname, 'uploads', imgName);
    const base64Data = img.data.replace(/^data:image\/png;base64,/, '');
    fs.writeFileSync(imgPath, base64Data, 'base64');
    content = content.replace(img.placeholder, `![pasted image](/uploads/${imgName})`);
    attachments.push({
      name: imgName,
      path: `/uploads/${imgName}`
    });
  });
  
  const note = {
    title: req.body.title,
    content,
    categories: req.body.categories ? req.body.categories.split(',').map(c => c.trim()) : [],
    tags: req.body.tags ? req.body.tags.split(',').map(t => t.trim()) : [],
    attachments,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  
  fs.writeFileSync(path.join(savePath, `${id}.json`), JSON.stringify(note));
  res.redirect(notebook ? `/?notebook=${encodeURIComponent(notebook)}` : '/');
});

app.get('/notes/:id', (req, res) => {
  try {
    // Search in all notebooks and main notes directory
    let notePath;
    if (fs.existsSync(path.join('notes', `${req.params.id}.json`))) {
      notePath = path.join('notes', `${req.params.id}.json`);
    } else {
      const notebooks = getAllNotebooks();
      for (const notebook of notebooks) {
        const possiblePath = path.join('notebooks', notebook, `${req.params.id}.json`);
        if (fs.existsSync(possiblePath)) {
          notePath = possiblePath;
          break;
        }
      }
    }
    
    if (!notePath) {
      return res.status(404).send('Note not found');
    }
    
    const note = JSON.parse(fs.readFileSync(notePath, 'utf8'));
    note.htmlContent = marked.parse(note.content);
    res.render('note', { note, id: req.params.id });
  } catch (err) {
    res.status(404).send('Note not found');
  }
});

app.get('/notes/:id/edit', (req, res) => {
  try {
    let notePath;
    if (fs.existsSync(path.join('notes', `${req.params.id}.json`))) {
      notePath = path.join('notes', `${req.params.id}.json`);
    } else {
      const notebooks = getAllNotebooks();
      for (const notebook of notebooks) {
        const possiblePath = path.join('notebooks', notebook, `${req.params.id}.json`);
        if (fs.existsSync(possiblePath)) {
          notePath = possiblePath;
          break;
        }
      }
    }
    
    if (!notePath) {
      return res.status(404).send('Note not found');
    }
    
    const note = JSON.parse(fs.readFileSync(notePath, 'utf8'));
    const notebooks = getAllNotebooks();
    res.render('edit-note', { note, id: req.params.id, notebooks });
  } catch (err) {
    res.status(404).send('Note not found');
  }
});

app.post('/notes/:id', upload.array('attachments', 5), (req, res) => {
  try {
    let notePath;
    if (fs.existsSync(path.join('notes', `${req.params.id}.json`))) {
      notePath = path.join('notes', `${req.params.id}.json`);
    } else {
      const notebooks = getAllNotebooks();
      for (const notebook of notebooks) {
        const possiblePath = path.join('notebooks', notebook, `${req.params.id}.json`);
        if (fs.existsSync(possiblePath)) {
          notePath = possiblePath;
          break;
        }
      }
    }
    
    if (!notePath) {
      return res.status(404).send('Note not found');
    }
    
    const existingNote = JSON.parse(fs.readFileSync(notePath, 'utf8'));
    const notebook = req.body.notebook || '';
    const newPath = notebook ? path.join('notebooks', notebook, `${req.params.id}.json`) : path.join('notes', `${req.params.id}.json`);
    
    // Handle file uploads
    const newAttachments = (req.files || []).map(file => ({
      name: file.originalname,
      path: `/uploads/${file.filename}`
    }));
    
    // Handle pasted images
    let content = req.body.content;
    const pastedImages = JSON.parse(req.body.pastedImages || '[]');
    pastedImages.forEach(img => {
      const imgName = `pasted-${Date.now()}.png`;
      const imgPath = path.join(__dirname, 'uploads', imgName);
      const base64Data = img.data.replace(/^data:image\/png;base64,/, '');
      fs.writeFileSync(imgPath, base64Data, 'base64');
      content = content.replace(img.placeholder, `![pasted image](/uploads/${imgName})`);
      newAttachments.push({
        name: imgName,
        path: `/uploads/${imgName}`
      });
    });
    
    const note = {
      title: req.body.title,
      content,
      categories: req.body.categories ? req.body.categories.split(',').map(c => c.trim()) : [],
      tags: req.body.tags ? req.body.tags.split(',').map(t => t.trim()) : [],
      attachments: [...(existingNote.attachments || []), ...newAttachments],
      createdAt: existingNote.createdAt,
      updatedAt: new Date().toISOString()
    };
    
    // Move note if notebook changed
    if (notePath !== newPath) {
      fs.unlinkSync(notePath);
    }
    
    fs.writeFileSync(newPath, JSON.stringify(note));
    res.redirect(`/notes/${req.params.id}`);
  } catch (err) {
    res.status(404).send('Note not found');
  }
});

app.post('/notes/:id/delete', (req, res) => {
  try {
    let notePath;
    if (fs.existsSync(path.join('notes', `${req.params.id}.json`))) {
      notePath = path.join('notes', `${req.params.id}.json`);
    } else {
      const notebooks = getAllNotebooks();
      for (const notebook of notebooks) {
        const possiblePath = path.join('notebooks', notebook, `${req.params.id}.json`);
        if (fs.existsSync(possiblePath)) {
          notePath = possiblePath;
          break;
        }
      }
    }
    
    if (!notePath) {
      return res.status(404).send('Note not found');
    }
    
    fs.unlinkSync(notePath);
    res.redirect('/');
  } catch (err) {
    res.status(404).send('Note not found');
  }
});

app.post('/notes/:id/attachments/:attachment/delete', (req, res) => {
  try {
    let notePath;
    if (fs.existsSync(path.join('notes', `${req.params.id}.json`))) {
      notePath = path.join('notes', `${req.params.id}.json`);
    } else {
      const notebooks = getAllNotebooks();
      for (const notebook of notebooks) {
        const possiblePath = path.join('notebooks', notebook, `${req.params.id}.json`);
        if (fs.existsSync(possiblePath)) {
          notePath = possiblePath;
          break;
        }
      }
    }
    
    if (!notePath) {
      return res.status(404).send('Note not found');
    }
    
    const note = JSON.parse(fs.readFileSync(notePath, 'utf8'));
    note.attachments = note.attachments.filter(att => att.path !== `/uploads/${req.params.attachment}`);
    fs.writeFileSync(notePath, JSON.stringify(note));
    
    // Delete the actual file
    const filePath = path.join(__dirname, 'uploads', req.params.attachment);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    
    res.redirect(`/notes/${req.params.id}/edit`);
  } catch (err) {
    res.status(404).send('Note not found');
  }
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});