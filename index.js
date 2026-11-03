import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import { MongoClient, ObjectId } from "mongodb";
import multer from "multer";
import { getAuth } from "./auth.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;
const frontendOrigin = new URL(
  process.env.FRONTEND_URL || process.env.BETTER_AUTH_URL || "http://localhost:3000",
).origin;
const client = new MongoClient(process.env.MONGODB_URI);
const database = client.db("book_nook");
const booksCollection = database.collection("books");
const borrowsCollection = database.collection("borrows");
const categories = new Set(["Fiction", "Science", "History", "Kids", "Others"]);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter(_request, file, callback) {
    if (!["image/jpeg", "image/png", "image/webp", "image/gif"].includes(file.mimetype)) {
      const error = new Error("Upload a JPG, PNG, WEBP, or GIF image.");
      error.status = 400;
      callback(error);
      return;
    }
    callback(null, true);
  },
});

app.use(cors({ origin: frontendOrigin, credentials: true }));
app.use(express.json({ limit: "1mb" }));

function isValidObjectId(id) {
  return ObjectId.isValid(id);
}

function serializeDocument(document) {
  if (!document) return document;
  const { _id, ...fields } = document;
  return { ...fields, id: _id.toString() };
}

function getBookOwnerFilter(user) {
  return {
    $or: [
      { "addedBy.userId": user.id },
      { "addedBy.email": user.email },
    ],
  };
}

async function getCurrentUser(request) {
  const headers = new Headers();
  if (request.headers.cookie) {
    headers.set("cookie", request.headers.cookie);
  }
  const session = await getAuth().api.getSession({ headers });
  return session?.user ?? null;
}

async function requireUser(request, response, next) {
  try {
    const user = await getCurrentUser(request);
    if (!user) {
      response.status(401).json({ message: "Please log in to continue." });
      return;
    }
    request.user = user;
    next();
  } catch (error) {
    next(error);
  }
}

function requireTrustedOrigin(request, response, next) {
  if (request.get("origin") !== frontendOrigin) {
    response.status(403).json({ message: "This request origin is not allowed." });
    return;
  }
  next();
}

function validateBookFields({ title, author, category, description }) {
  if (
    typeof title !== "string" ||
    !title.trim() ||
    title.trim().length > 160 ||
    typeof author !== "string" ||
    !author.trim() ||
    author.trim().length > 120 ||
    !categories.has(category) ||
    typeof description !== "string" ||
    !description.trim() ||
    description.trim().length > 2000
  ) {
    return "Enter a valid title, author, category, and description.";
  }
  return null;
}

async function uploadToImgbb(file) {
  const apiKey = process.env.IMGBB_API_KEY?.trim();
  if (!apiKey) {
    const error = new Error("Book image uploads are not configured. Set IMGBB_API_KEY.");
    error.status = 503;
    throw error;
  }

  const form = new FormData();
  form.append("image", new Blob([file.buffer], { type: file.mimetype }), file.originalname);
  const response = await fetch(
    `https://api.imgbb.com/1/upload?key=${encodeURIComponent(apiKey)}`,
    { method: "POST", body: form, signal: AbortSignal.timeout(30_000) },
  );
  const result = await response.json();
  if (!response.ok || !result.success || !result.data?.url) {
    const error = new Error(result.error?.message || "The image upload failed.");
    error.status = 502;
    throw error;
  }
  return result.data.url;
}

app.get("/books", async (request, response, next) => {
  try {
    let query = {};
    if (request.query.mine === "true") {
      const user = await getCurrentUser(request);
      if (!user) {
        response.status(401).json({ message: "Please log in to view your books." });
        return;
      }
      query = getBookOwnerFilter(user);
    }
    const books = await booksCollection.find(query).sort({ createdAt: -1 }).toArray();
    response.json(books.map(serializeDocument));
  } catch (error) {
    next(error);
  }
});

app.post(
  "/books",
  requireTrustedOrigin,
  requireUser,
  upload.single("image"),
  async (request, response, next) => {
    try {
      const issue = validateBookFields(request.body);
      if (issue) {
        response.status(400).json({ message: issue });
        return;
      }
      if (!request.file) {
        response.status(400).json({ message: "Choose a book cover image to upload." });
        return;
      }

      const now = new Date();
      const book = {
        title: request.body.title.trim(),
        author: request.body.author.trim(),
        category: request.body.category,
        image: await uploadToImgbb(request.file),
        description: request.body.description.trim(),
        addedBy: {
          userId: request.user.id,
          name: request.user.name,
          email: request.user.email,
        },
        createdAt: now,
        updatedAt: now,
      };
      const result = await booksCollection.insertOne(book);
      response.status(201).json(serializeDocument({ ...book, _id: result.insertedId }));
    } catch (error) {
      next(error);
    }
  },
);

app.get("/books/:id", requireUser, async (request, response, next) => {
  try {
    if (!isValidObjectId(request.params.id)) {
      response.status(400).json({ message: "Invalid book ID." });
      return;
    }
    const book = await booksCollection.findOne({ _id: new ObjectId(request.params.id) });
    if (!book) {
      response.status(404).json({ message: "Book not found." });
      return;
    }
    response.json(serializeDocument(book));
  } catch (error) {
    next(error);
  }
});

app.patch(
  "/books/:id",
  requireTrustedOrigin,
  requireUser,
  upload.single("image"),
  async (request, response, next) => {
    try {
      if (!isValidObjectId(request.params.id)) {
        response.status(400).json({ message: "Invalid book ID." });
        return;
      }
      const issue = validateBookFields(request.body);
      if (issue) {
        response.status(400).json({ message: issue });
        return;
      }

      const updates = {
        title: request.body.title.trim(),
        author: request.body.author.trim(),
        category: request.body.category,
        description: request.body.description.trim(),
        updatedAt: new Date(),
      };
      if (request.file) {
        updates.image = await uploadToImgbb(request.file);
      }
      const result = await booksCollection.updateOne(
        {
          _id: new ObjectId(request.params.id),
          ...getBookOwnerFilter(request.user),
        },
        { $set: updates },
      );
      if (!result.matchedCount) {
        response.status(404).json({ message: "Book not found or you do not own it." });
        return;
      }
      response.json({ message: "Book updated successfully." });
    } catch (error) {
      next(error);
    }
  },
);

app.delete("/books/:id", requireTrustedOrigin, requireUser, async (request, response, next) => {
  try {
    if (!isValidObjectId(request.params.id)) {
      response.status(400).json({ message: "Invalid book ID." });
      return;
    }
    const bookId = new ObjectId(request.params.id);
    const result = await booksCollection.deleteOne({
      _id: bookId,
      ...getBookOwnerFilter(request.user),
    });
    if (!result.deletedCount) {
      response.status(404).json({ message: "Book not found or you do not own it." });
      return;
    }
    await borrowsCollection.deleteMany({ bookId });
    response.json({ message: "Book deleted successfully." });
  } catch (error) {
    next(error);
  }
});

app.post("/borrows", requireTrustedOrigin, requireUser, async (request, response, next) => {
  try {
    const { bookId, returnDate } = request.body ?? {};
    if (!bookId || !isValidObjectId(bookId)) {
      response.status(400).json({ message: "A valid bookId is required." });
      return;
    }
    if (typeof returnDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(returnDate)) {
      response.status(400).json({ message: "Choose a valid return date." });
      return;
    }
    const book = await booksCollection.findOne({ _id: new ObjectId(bookId) });
    if (!book) {
      response.status(404).json({ message: "Book not found." });
      return;
    }
    const borrowerFilter = {
      bookId: new ObjectId(bookId),
      $or: [
        { borrowerId: request.user.id },
        { borrowerEmail: request.user.email },
      ],
    };
    if (await borrowsCollection.findOne(borrowerFilter)) {
      response.status(409).json({ message: "You have already borrowed this book." });
      return;
    }
    const borrow = {
      bookId: new ObjectId(bookId),
      bookTitle: book.title,
      bookImage: book.image,
      borrowerId: request.user.id,
      borrowerEmail: request.user.email,
      borrowedAt: new Date(),
      returnDate,
    };
    const result = await borrowsCollection.insertOne(borrow);
    response.status(201).json(serializeDocument({ ...borrow, _id: result.insertedId }));
  } catch (error) {
    next(error);
  }
});

app.get("/borrows", requireUser, async (request, response, next) => {
  try {
    const borrows = await borrowsCollection.find({
      $or: [
        { borrowerId: request.user.id },
        { borrowerEmail: request.user.email },
      ],
    }).sort({ borrowedAt: -1 }).toArray();
    response.json(borrows.map(serializeDocument));
  } catch (error) {
    next(error);
  }
});

app.delete("/borrows/:id", requireTrustedOrigin, requireUser, async (request, response, next) => {
  try {
    if (!isValidObjectId(request.params.id)) {
      response.status(400).json({ message: "Invalid borrow ID." });
      return;
    }
    const result = await borrowsCollection.deleteOne({
      _id: new ObjectId(request.params.id),
      $or: [
        { borrowerId: request.user.id },
        { borrowerEmail: request.user.email },
      ],
    });
    if (!result.deletedCount) {
      response.status(404).json({ message: "Borrow record not found." });
      return;
    }
    response.status(204).end();
  } catch (error) {
    next(error);
  }
});

app.use((error, _request, response, _next) => {
  console.error("BookNook API request failed:", error);
  response.status(error.status || 500).json({
    message: error.status ? error.message : "The server could not complete the request.",
  });
});

async function startServer() {
  await client.connect();
  console.log("Connected to MongoDB.");
  app.listen(PORT, () => {
    console.log(`BookNook API is running on port ${PORT}.`);
  });
}

startServer().catch((error) => {
  console.error("Failed to start BookNook API:", error);
  process.exitCode = 1;
});
