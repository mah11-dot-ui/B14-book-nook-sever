import express from 'express'
import cors from 'cors'
import { MongoClient, ObjectId } from 'mongodb';
import 'dotenv/config'

const app = express()
const PORT = process.env.PORT || 5000

// middleware
app.use(cors())
app.use(express.json())



const client = new MongoClient(process.env.MONGODB_URI);
const database = client.db('book_nook');
const booksCollection = database.collection('books');
const borrowsCollection = database.collection('borrows');

function getAuthenticatedUserEmail(req, res) {
  const email = req.user?.email;
  if (!email) {
    res.status(401).send({ message: 'Authentication required' });
    return null;
  }
  return email;
}

function isValidObjectId(id) {
  return ObjectId.isValid(id);
}

export async function connectToMongoDB() {
  await client.connect();
  console.log("You successfully connected to MongoDB!");
  return client;
}

app.get('/books', async (req, res) => {
  const books = await booksCollection.find({}).toArray();
  res.send(books);
});

app.post(['/books', '/add-book'], async (req, res) => {
  const book = req.body;
  if (!book || typeof book !== 'object' || Array.isArray(book)) {
    return res.status(400).send({ message: 'A book object is required' });
  }
  const { _id, ...bookData } = book;
  const result = await booksCollection.insertOne(bookData);
  res.status(201).send({ ...bookData, _id: result.insertedId });
})

app.get('/books/:id', async (req, res) => {
  const bookId = req.params.id;
  if (!isValidObjectId(bookId)) {
    return res.status(400).send({ message: 'Invalid book id' });
  }
  const book = await booksCollection.findOne({ _id: new ObjectId(bookId) });
  if (book) {
    res.send(book);
  } else {
    res.status(404).send({ message: 'Book not found' });
  }
})

app.patch(['/books/:id', '/my-books/:id'], async (req, res) => {
  const id = req.params.id;
  const updatedBook = req.body;
  if (!isValidObjectId(id)) {
    return res.status(400).send({ message: 'Invalid book id' });
  }
  if (!updatedBook || typeof updatedBook !== 'object' || Array.isArray(updatedBook)) {
    return res.status(400).send({ message: 'A book update object is required' });
  }
  const { _id, ...bookData } = updatedBook;
  const result = await booksCollection.updateOne(
    { _id: new ObjectId(id) },
    { $set: bookData }
  );
  if (result.matchedCount === 0) {
    return res.status(404).send({ message: 'Book not found' });
  }
  res.send(result);
})

app.delete(['/books/:id', '/my-books/:id'], async (req, res) => {
  const id = req.params.id;
  if (!isValidObjectId(id)) {
    return res.status(400).send({ message: 'Invalid book id' });
  }
  const result = await booksCollection.deleteOne({ _id: new ObjectId(id) });
  if (result.deletedCount === 0) {
    return res.status(404).send({ message: 'Book not found' });
  }
  res.send(result);
 })

app.post('/borrows', async (req, res) => {
  const borrowerEmail = getAuthenticatedUserEmail(req, res);
  if (!borrowerEmail) return;

  const { bookId } = req.body ?? {};
  if (!bookId || !isValidObjectId(bookId)) {
    return res.status(400).send({ message: 'A valid bookId is required' });
  }
  const book = await booksCollection.findOne({ _id: new ObjectId(bookId) });
  if (!book) {
    return res.status(404).send({ message: 'Book not found' });
  }

  const borrow = {
    bookId: new ObjectId(bookId),
    borrowerEmail,
    borrowedAt: new Date()
  };
  const result = await borrowsCollection.insertOne(borrow);
  res.status(201).send({ ...borrow, _id: result.insertedId });
});

app.get('/borrows', async (req, res) => {
  const borrowerEmail = getAuthenticatedUserEmail(req, res);
  if (!borrowerEmail) return;

  const borrows = await borrowsCollection.find({ borrowerEmail }).toArray();
  res.send(borrows);
});

// Call this only when your application terminates
// export async function disconnectFromMongoDB() {
//   await client.close();
// }

app.get('/', (req, res) => {
    res.send("Hello World")
})

async function startServer() {
  await connectToMongoDB();
  app.listen(PORT, () => {
    console.log("BOOK NOOK is running!!!!!!!!!!!!!!!!")
  });
}

startServer().catch((err) => {
  console.error("Failed to start server:", err);
  process.exitCode = 1;
});
