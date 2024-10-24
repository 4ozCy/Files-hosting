require('dotenv').config();
const express = require('express');
const multer = require('multer');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const crypto = require('crypto');
const favicon = require('serve-favicon');
const mime = require('mime-types');
const app = express();
const PORT = process.env.PORT || 8080;

const db = new sqlite3.Database('./files.db', (err) => {
  if (err) {
    console.error('Failed to connect to SQLite', err);
    process.exit(1);
  }

  console.log('Connected to the SQLite database');

  db.run(`
    CREATE TABLE IF NOT EXISTS files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      filename TEXT NOT NULL,
      filedata BLOB NOT NULL
    )
  `, (err) => {
    if (err) {
      console.error('Failed to create files table:', err);
      process.exit(1);
    }
  });
});

function generateRandomString(length) {
  return crypto.randomBytes(length).toString('hex').slice(0, length);
}

const upload = multer({
  limits: { fileSize: 10000 * 1024 * 1024 },
  storage: multer.memoryStorage(),
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif|mp4|avi|mov|mkv/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);

    if (extname && mimetype) {
      return cb(null, true);
    } else {
      cb(new Error('File type not allowed. Only images and videos are allowed.'));
    }
  }
}).single('file');

app.use(express.static('public'));
app.use(favicon(path.join(__dirname, 'favicon.ico')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.post('/file', (req, res) => {
  upload(req, res, (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).send('File is too large. Maximum size is 100MB.');
      } else {
        return res.status(400).send(err.message);
      }
    }

    if (!req.file) {
      return res.status(400).send('No file uploaded.');
    }

    const uniqueFilename = `${generateRandomString(3)}${path.extname(req.file.originalname)}`;
    const query = `INSERT INTO files (filename, filedata) VALUES (?, ?)`;

    db.run(query, [uniqueFilename, req.file.buffer], function(err) {
      if (err) {
        console.error('Failed to store file metadata:', err);
        return res.status(500).send('Failed to store file metadata.');
      }

      const fileUrl = `${req.protocol}://${req.get('host')}/file/${uniqueFilename}`;
      res.send({ fileUrl });
    });
  });
});

app.get('/file/:filename', (req, res) => {
    const filename = req.params.filename;

    const query = 'SELECT filepath FROM files WHERE filename = ?';

    db.get(query, [filename], (err, row) => {
        if (err) {
            console.error('Database error:', err);
            return res.status(500).send('Database error.');
        }

        if (!row) {
            return res.status(404).send('File not found.');
        }

        const filePath = row.filepath;
        const ext = path.extname(filePath).toLowerCase();

        const mimeTypes = {
            '.mp4': 'video/mp4',
            '.mov': 'video/quicktime',
            '.avi': 'video/x-msvideo',
            '.mkv': 'video/x-matroska',
            '.jpeg': 'image/jpeg',
            '.jpg': 'image/jpeg',
            '.png': 'image/png',
            '.gif': 'image/gif'
        };

        // Ensure content type is set correctly
        const contentType = mimeTypes[ext] || 'application/octet-stream';
        const stat = fs.statSync(filePath);
        const fileSize = stat.size;
        const range = req.headers.range;

        if (range) {
            const parts = range.replace(/bytes=/, "").split("-");
            const start = parseInt(parts[0], 10);
            const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
            const chunkSize = (end - start) + 1;

            res.writeHead(206, {
                'Content-Range': `bytes ${start}-${end}/${fileSize}`,
                'Accept-Ranges': 'bytes',
                'Content-Length': chunkSize,
                'Content-Type': contentType
            });

            const stream = fs.createReadStream(filePath, { start, end });
            stream.pipe(res).on('error', (streamErr) => {
                console.error('Error streaming file:', streamErr);
                res.status(500).send('Error streaming the file.');
            });

        } else {
            res.writeHead(200, {
                'Content-Length': fileSize,
                'Content-Type': contentType
            });

            const stream = fs.createReadStream(filePath);
            stream.pipe(res).on('error', (streamErr) => {
                console.error('Error reading the file:', streamErr);
                res.status(500).send('Error retrieving the file.');
            });
        }
    });
});

app.post('/api/file', (req, res) => {
  upload(req, res, (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: 'File is too large. Maximum size is 100MB.' });
      } else {
        return res.status(400).json({ error: err.message });
      }
    }

    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded.' });
    }

    const uniqueFilename = `${generateRandomString(3)}${path.extname(req.file.originalname)}`;
    const query = `INSERT INTO files (filename, filedata) VALUES (?, ?)`;

    db.run(query, [uniqueFilename, req.file.buffer], function(err) {
      if (err) {
        console.error('Failed to store file metadata:', err);
        return res.status(500).json({ error: 'Failed to store file metadata.' });
      }

      const fileUrl = `${req.protocol}://${req.get('host')}/file/${uniqueFilename}`;
      res.json({ fileUrl });
    });
  });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
