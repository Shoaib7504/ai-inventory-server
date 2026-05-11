const express = require("express");
const cors = require("cors");
const admin = require("firebase-admin");
const app = express();
require("dotenv").config();
const dns = require("dns");

// Change DNS servers
dns.setServers(["1.1.1.1", "8.8.8.8"]);

// Use Render's dynamic PORT or fallback to 3000
const port = process.env.PORT || 3000;

// Load Firebase service account
let serviceAccount;
if (process.env.FIREBASE_SERVICE_ACCOUNT) {
  // Production (Render): decode base64 then parse JSON
  const decoded = Buffer.from(
    process.env.FIREBASE_SERVICE_ACCOUNT,
    "base64"
  ).toString("utf-8");
  serviceAccount = JSON.parse(decoded);
} else {
  // Local development: read directly from file
  serviceAccount = require("./serviceKey.json");
}

// Initialize Firebase Admin
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

//  CORS CONFIGURATION
const allowedOrigins = [
  "http://localhost:5173",
  "http://localhost:3000",
  "https://ai-manager-inventory.web.app",
  "https://ai-manager-inventory.firebaseapp.com",
];

const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests with no origin (mobile apps, curl, Postman)
    if (!origin) return callback(null, true);

    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    } else {
      return callback(new Error(`CORS policy: Origin ${origin} not allowed.`));
    }
  },
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true,
  optionsSuccessStatus: 200,
};

// Apply CORS middleware BEFORE all routes
app.use(cors(corsOptions));



app.use(express.json());

const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

const uri = `mongodb+srv://${process.env.DB_USERNAME}:${process.env.DB_PASSWORD}@cluster0.qoz91xh.mongodb.net/?appName=Cluster0`;

// Create MongoClient
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

// FIREBASE TOKEN VERIFICATION MIDDLEWARE 
const verifyToken = async (req, res, next) => {
  const authorization = req.headers.authorization;

  if (!authorization) {
    return res.status(401).send({ message: "Unauthorized access." });
  }

  const token = authorization.split(" ")[1];

  try {
    const decodedToken = await admin.auth().verifyIdToken(token);
    req.user = decodedToken;
    next();
  } catch (error) {
    return res.status(401).send({ message: "Unauthorized access." });
  }
};

//  ROOT ROUTE 
app.get("/", (req, res) => {
  res.send("Server is running!");
});

// MAIN DATABASE FUNCTION 
async function run() {
  try {
    // Connect once on startup
    await client.connect();

    const db = client.db("model-db");
    const modelCollection = db.collection("models");
    const downloadCollection = db.collection("downloads");

    // MODEL ROUTES
    // GET all models (public)
    app.get("/models", async (req, res) => {
      try {
        const result = await modelCollection.find().toArray();
        res.send(result);
      } catch (error) {
        res
          .status(500)
          .send({ message: "Failed to fetch models.", error: error.message });
      }
    });

    // GET single model by ID (protected)
    app.get("/models/:id", verifyToken, async (req, res) => {
      try {
        const { id } = req.params;

        if (!ObjectId.isValid(id)) {
          return res.status(400).send({ message: "Invalid model ID." });
        }

        const objectId = new ObjectId(id);
        const result = await modelCollection.findOne({ _id: objectId });

        if (!result) {
          return res.status(404).send({ message: "Model not found." });
        }

        res.send({ success: true, result });
      } catch (error) {
        res
          .status(500)
          .send({ message: "Failed to fetch model.", error: error.message });
      }
    });

    // POST add a new model (public)
    app.post("/models", async (req, res) => {
      try {
        const data = req.body;

        if (!data || Object.keys(data).length === 0) {
          return res.status(400).send({ message: "Request body is empty." });
        }

        const result = await modelCollection.insertOne(data);
        res.send(result);
      } catch (error) {
        res
          .status(500)
          .send({ message: "Failed to add model.", error: error.message });
      }
    });

    // PUT update a model by ID
    app.put("/models/:id", async (req, res) => {
      try {
        const { id } = req.params;
        const data = req.body;

        if (!ObjectId.isValid(id)) {
          return res.status(400).send({ message: "Invalid model ID." });
        }

        if (!data || Object.keys(data).length === 0) {
          return res.status(400).send({ message: "No update data provided." });
        }

        const objectId = new ObjectId(id);
        const filter = { _id: objectId };
        const update = { $set: data };

        const result = await modelCollection.updateOne(filter, update);

        if (result.matchedCount === 0) {
          return res.status(404).send({ message: "Model not found." });
        }

        res.send({ success: true, result });
      } catch (error) {
        res
          .status(500)
          .send({ message: "Failed to update model.", error: error.message });
      }
    });

    // DELETE a model by ID
    app.delete("/models/:id", async (req, res) => {
      try {
        const { id } = req.params;

        if (!ObjectId.isValid(id)) {
          return res.status(400).send({ message: "Invalid model ID." });
        }

        const objectId = new ObjectId(id);
        const filter = { _id: objectId };
        const result = await modelCollection.deleteOne(filter);

        if (result.deletedCount === 0) {
          return res.status(404).send({ message: "Model not found." });
        }

        res.send({ success: true, result });
      } catch (error) {
        res
          .status(500)
          .send({ message: "Failed to delete model.", error: error.message });
      }
    });

    // GET models by logged-in user (protected)
    app.get("/my-models", verifyToken, async (req, res) => {
      try {
        const email = req.query.email;

        if (!email) {
          return res
            .status(400)
            .send({ message: "Email query parameter is required." });
        }

        const result = await modelCollection
          .find({ createdBy: email })
          .toArray();
        res.send(result);
      } catch (error) {
        res.status(500).send({
          message: "Failed to fetch your models.",
          error: error.message,
        });
      }
    });

    // ─── DOWNLOAD ROUTES ───────────────────────────────────────────────────────

    // POST log a download
    app.post("/downloads", async (req, res) => {
      try {
        const data = req.body;

        if (!data || Object.keys(data).length === 0) {
          return res.status(400).send({ message: "Request body is empty." });
        }

        const result = await downloadCollection.insertOne(data);
        res.send(result);
      } catch (error) {
        res
          .status(500)
          .send({ message: "Failed to log download.", error: error.message });
      }
    });

    // GET downloads by logged-in user (protected)
    app.get("/my-downloads", verifyToken, async (req, res) => {
      try {
        const email = req.query.email;

        if (!email) {
          return res
            .status(400)
            .send({ message: "Email query parameter is required." });
        }

        const result = await downloadCollection
          .find({ downloadedBy: email })
          .toArray();
        res.send(result);
      } catch (error) {
        res.status(500).send({
          message: "Failed to fetch your downloads.",
          error: error.message,
        });
      }
    });

    console.log(" Connected to MongoDB successfully!");
  } catch (error) {
    console.error(" Failed to connect to MongoDB:", error);
    process.exit(1);
  }
}

run();

// Graceful shutdown — close MongoDB on process exit
process.on("SIGINT", async () => {
  await client.close();
  console.log("MongoDB connection closed.");
  process.exit(0);
});

app.listen(port, () => {
  console.log(` Server is running on port ${port}`);
});