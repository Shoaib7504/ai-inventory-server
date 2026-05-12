const express = require("express");
const cors = require("cors");
const admin = require("firebase-admin");
const app = express();
require("dotenv").config();
const dns = require("dns");

dns.setServers(["1.1.1.1", "8.8.8.8"]);

const port = process.env.PORT || 3000;

let serviceAccount;
if (process.env.FIREBASE_SERVICE_ACCOUNT) {
  const decoded = Buffer.from(
    process.env.FIREBASE_SERVICE_ACCOUNT,
    "base64"
  ).toString("utf-8");
  serviceAccount = JSON.parse(decoded);
} else {
  serviceAccount = require("./serviceKey.json");
}

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const allowedOrigins = [
  "http://localhost:5173",
  "http://localhost:3000",
  "https://ai-manager-inventory.web.app",
  "https://ai-manager-inventory.firebaseapp.com",
];

const corsOptions = {
  origin: function (origin, callback) {
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

app.use(cors(corsOptions));
app.use(express.json());

const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

const uri = `mongodb+srv://${process.env.DB_USERNAME}:${process.env.DB_PASSWORD}@cluster0.qoz91xh.mongodb.net/?appName=Cluster0`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

//  verifyToken middleware
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

app.get("/", (req, res) => {
  res.send("Server is running!");
});

async function run() {
  try {
    await client.connect();

    const db = client.db("model-db");
    const modelCollection = db.collection("models");
    const downloadCollection = db.collection("downloads");

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

        if (!ObjectId.isValid(id)) {
          return res.status(400).send({ message: "Invalid model ID." });
        }

        const result = await modelCollection.findOne({ _id: new ObjectId(id) });

        if (!result) {
          return res.status(404).send({ message: "Model not found." });
        }

        res.send({ success: true, result });
      } catch (error) {
        res.status(500).send({ message: "Failed to fetch model.", error: error.message });
      }
    });

    //  POST add a new model 
    app.post("/models", verifyToken, async (req, res) => {
      try {
        const data = req.body;

        if (!data || Object.keys(data).length === 0) {
          return res.status(400).send({ message: "Request body is empty." });
        }

        const result = await modelCollection.insertOne(data);
        res.send(result);
      } catch (error) {
        res.status(500).send({ message: "Failed to add model.", error: error.message });
      }
    });

    // PUT update a model by ID 
    app.put("/models/:id", verifyToken, async (req, res) => {
      try {
        const { id } = req.params;
        const data = req.body;

        if (!ObjectId.isValid(id)) {
          return res.status(400).send({ message: "Invalid model ID." });
        }

        if (!data || Object.keys(data).length === 0) {
          return res.status(400).send({ message: "No update data provided." });
        }

        const result = await modelCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: data }
        );

        if (result.matchedCount === 0) {
          return res.status(404).send({ message: "Model not found." });
        }

        res.send({ success: true, result });
      } catch (error) {
        res.status(500).send({ message: "Failed to update model.", error: error.message });
      }
    });

    //  DELETE a model by ID (protected)
    app.delete("/models/:id", verifyToken, async (req, res) => {
      try {
        const { id } = req.params;

        if (!ObjectId.isValid(id)) {
          return res.status(400).send({ message: "Invalid model ID." });
        }

        const result = await modelCollection.deleteOne({ _id: new ObjectId(id) });

        if (result.deletedCount === 0) {
          return res.status(404).send({ message: "Model not found." });
        }

        res.send({ success: true, result });
      } catch (error) {
        res.status(500).send({ message: "Failed to delete model.", error: error.message });
      }
    });

    //  GET models by logged-in user 
    app.get("/my-models", verifyToken, async (req, res) => {
      try {
        const email = req.user.email;  

        const result = await modelCollection
          .find({ createdBy: email })
          .toArray();
        res.send(result);
      } catch (error) {
        res.status(500).send({ message: "Failed to fetch your models.", error: error.message });
      }
    });

    // POST log a download (public)
    app.post("/downloads", async (req, res) => {
      try {
        const data = req.body;

        if (!data || Object.keys(data).length === 0) {
          return res.status(400).send({ message: "Request body is empty." });
        }

        const result = await downloadCollection.insertOne(data);
        res.send(result);
      } catch (error) {
        res.status(500).send({ message: "Failed to log download.", error: error.message });
      }
    });

    //  GET downloads by logged-in user 
    app.get("/my-downloads", verifyToken, async (req, res) => {
      try {
        const email = req.user.email;  

        const result = await downloadCollection
          .find({ downloadedBy: email })
          .toArray();
        res.send(result);
      } catch (error) {
        res.status(500).send({ message: "Failed to fetch your downloads.", error: error.message });
      }
    });

    console.log("Connected to MongoDB successfully!");
  } catch (error) {
    console.error("Failed to connect to MongoDB:", error);
    process.exit(1);
  }
}

run();

process.on("SIGINT", async () => {
  await client.close();
  console.log("MongoDB connection closed.");
  process.exit(0);
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});