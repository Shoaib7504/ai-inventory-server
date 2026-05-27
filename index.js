const express = require("express");
const cors = require("cors");
const admin = require("firebase-admin");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const app = express();
require("dotenv").config();

const port = process.env.PORT || 3000;

// Firebase init
let serviceAccount;
if (process.env.FIREBASE_SERVICE_ACCOUNT) {
  const decoded = Buffer.from(
    process.env.FIREBASE_SERVICE_ACCOUNT, "base64"
  ).toString("utf-8");
  serviceAccount = JSON.parse(decoded);
} else {
  serviceAccount = require("./serviceKey.json");
}

admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });

// CORS
const allowedOrigins = [
  "http://localhost:5173",
  "http://localhost:3000",
  "https://ai-manager-inventory.web.app",
  "https://ai-manager-inventory.firebaseapp.com",
];

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error(`CORS policy: Origin ${origin} not allowed.`));
  },
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true,
  optionsSuccessStatus: 200,
}));

app.use(express.json());

// MongoDB 
const uri = `mongodb+srv://${process.env.DB_USERNAME}:${process.env.DB_PASSWORD}@cluster0.qoz91xh.mongodb.net/?appName=Cluster0`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
  maxPoolSize: 10,
  minPoolSize: 2,
  connectTimeoutMS: 5000,
  socketTimeoutMS: 10000,
});

client.connect()
  .then(() => console.log("MongoDB connected!"))
  .catch(err => {
    console.error("MongoDB connection failed:", err);
    process.exit(1);
  });

const db = client.db("model-db");
const modelCollection = db.collection("models");
const downloadCollection = db.collection("downloads");

// verifyToken middleware
const verifyToken = async (req, res, next) => {
  const authorization = req.headers.authorization;
  if (!authorization) return res.status(401).send({ message: "Unauthorized access." });

  const token = authorization.split(" ")[1];
  try {
    const decodedToken = await admin.auth().verifyIdToken(token);
    req.user = decodedToken;
    next();
  } catch {
    return res.status(401).send({ message: "Unauthorized access." });
  }
};

app.get("/", (req, res) => res.send("Server is running!"));

// GET all models (public)
app.get("/models", async (req, res) => {
  try {
    const result = await modelCollection.find().toArray();
    res.send(result);
  } catch (error) {
    res.status(500).send({ message: "Failed to fetch models.", error: error.message });
  }
});

// GET single model by ID
app.get("/models/:id", verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    if (!ObjectId.isValid(id)) return res.status(400).send({ message: "Invalid model ID." });

    const result = await modelCollection.findOne({ _id: new ObjectId(id) });
    if (!result) return res.status(404).send({ message: "Model not found." });

    res.send({ success: true, result });
  } catch (error) {
    res.status(500).send({ message: "Failed to fetch model.", error: error.message });
  }
});

// POST add a new model
app.post("/models", verifyToken, async (req, res) => {
  try {
    const data = req.body;
    if (!data || Object.keys(data).length === 0)
      return res.status(400).send({ message: "Request body is empty." });

    const result = await modelCollection.insertOne(data);
    res.send(result);
  } catch (error) {
    res.status(500).send({ message: "Failed to add model.", error: error.message });
  }
});

// PUT update a model
app.put("/models/:id", verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const data = req.body;

    if (!ObjectId.isValid(id)) return res.status(400).send({ message: "Invalid model ID." });
    if (!data || Object.keys(data).length === 0)
      return res.status(400).send({ message: "No update data provided." });

    const result = await modelCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: data }
    );

    if (result.matchedCount === 0) return res.status(404).send({ message: "Model not found." });

    res.send({ success: true, result });
  } catch (error) {
    res.status(500).send({ message: "Failed to update model.", error: error.message });
  }
});

// DELETE a model
app.delete("/models/:id", verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    if (!ObjectId.isValid(id)) return res.status(400).send({ message: "Invalid model ID." });

    const result = await modelCollection.deleteOne({ _id: new ObjectId(id) });
    if (result.deletedCount === 0) return res.status(404).send({ message: "Model not found." });

    res.send({ success: true, result });
  } catch (error) {
    res.status(500).send({ message: "Failed to delete model.", error: error.message });
  }
});

// GET my models
app.get("/my-models", verifyToken, async (req, res) => {
  try {
    const result = await modelCollection.find({ createdBy: req.user.email }).toArray();
    res.send(result);
  } catch (error) {
    res.status(500).send({ message: "Failed to fetch your models.", error: error.message });
  }
});
// Post downloads models
app.post("/downloads", async (req, res) => {
  try {
    const data = req.body;
    if (!data || Object.keys(data).length === 0)
      return res.status(400).send({ message: "Request body is empty." });

    const result = await downloadCollection.insertOne(data);
    res.send(result);
  } catch (error) {
    res.status(500).send({ message: "Failed to log download.", error: error.message });
  }
});

// GET my downloads
app.get("/my-downloads", verifyToken, async (req, res) => {
  try {
    const result = await downloadCollection.find({ downloadedBy: req.user.email }).toArray();
    res.send(result);
  } catch (error) {
    res.status(500).send({ message: "Failed to fetch your downloads.", error: error.message });
  }
});
const RENDER_URL = process.env.RENDER_EXTERNAL_URL || `http://localhost:${port}`;

setInterval(async () => {
  try {
    const res = await fetch(RENDER_URL + "/");
    console.log(`[Keep-alive] ping OK — status ${res.status}`);
  } catch (err) {
    console.error("[Keep-alive] ping failed:", err.message);
  }
}, 14 * 60 * 1000);
process.on("SIGINT", async () => {
  await client.close();
  console.log("MongoDB connection closed.");
  process.exit(0);
});

app.listen(port, () => console.log(`Server running on port ${port}`));