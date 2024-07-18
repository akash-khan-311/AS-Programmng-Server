const { MongoClient, ServerApiVersion } = require("mongodb");

const uri = process.env.MONGODB_URI;
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

let db;

async function connectToDatabase() {
  if (!db) {
    await client.connect();
    console.log("Connected to MongoDB");
    db = client.db("as-programming-db");
  }
  const db = client.db("as-programming-db");
  return { db, client };
}

module.exports = connectToDatabase;
