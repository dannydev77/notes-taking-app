const express = require('express');
const bodyParser = require('body-parser');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');
const marked = require('marked');

const app = express();
const PORT = 3000;

// Configure middleware
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('public'));

// Set EJS as the view engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Configure marked (Markdown)
marked.setOptions({
  breaks: true,
  gfm: true
});

// Create notes directory if it doesn't exist
if (!fs.existsSync('notes')) {
  fs.mkdirSync('notes');
}

// Helper functions
const getAllNotes = () => {
  const files = fs.readdirSync('notes');
  return files.map(file => {
    const content = fs.readFileSync(`notes/${file}`, 'utf8');
    return { id: file.replace('.json', ''), ...JSON.parse(content) };
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
  const notes = getAllNotes();
  const categories = [...new Set(notes.flatMap(note => note.categories || []))];
  const tags = [...new Set(notes.flatMap(note => note.tags || []))];
  
  res.render('index', { 
    notes,
    categories,
    tags,
    searchQuery: req.query.search || '',
    selectedCategory: req.query.category || '',
    selectedTag: req.query.tag || ''
  });
});

app.get('/notes/new', (req, res) => {
  res.render('edit-note', { note: null });
});

app.post('/notes', (req, res) => {
  const id = uuidv4();
  const note = {
    title: req.body.title,
    content: req.body.content,
    categories: req.body.categories ? req.body.categories.split(',').map(c => c.trim()) : [],
    tags: req.body.tags ? req.body.tags.split(',').map(t => t.trim()) : [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  
  fs.writeFileSync(`notes/${id}.json`, JSON.stringify(note));
  res.redirect(`/notes/${id}`);
});

app.get('/notes/:id', (req, res) => {
  try {
    const note = JSON.parse(fs.readFileSync(`notes/${req.params.id}.json`, 'utf8'));
    // Convert markdown to HTML
    note.htmlContent = marked.parse(note.content);
    res.render('note', { note, id: req.params.id });
  } catch (err) {
    res.status(404).send('Note not found');
  }
});

app.get('/notes/:id/edit', (req, res) => {
  try {
    const note = JSON.parse(fs.readFileSync(`notes/${req.params.id}.json`, 'utf8'));
    res.render('edit-note', { note, id: req.params.id });
  } catch (err) {
    res.status(404).send('Note not found');
  }
});

app.post('/notes/:id', (req, res) => {
  try {
    const existingNote = JSON.parse(fs.readFileSync(`notes/${req.params.id}.json`, 'utf8'));
    const note = {
      title: req.body.title,
      content: req.body.content,
      categories: req.body.categories ? req.body.categories.split(',').map(c => c.trim()) : [],
      tags: req.body.tags ? req.body.tags.split(',').map(t => t.trim()) : [],
      createdAt: existingNote.createdAt,
      updatedAt: new Date().toISOString()
    };
    
    fs.writeFileSync(`notes/${req.params.id}.json`, JSON.stringify(note));
    res.redirect(`/notes/${req.params.id}`);
  } catch (err) {
    res.status(404).send('Note not found');
  }
});

app.post('/notes/:id/delete', (req, res) => {
  fs.unlinkSync(`notes/${req.params.id}.json`);
  res.redirect('/');
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});