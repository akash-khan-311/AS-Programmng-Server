const express = require("express");
const app = express();
require("dotenv").config();
const cors = require("cors");
const cookieParser = require("cookie-parser");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const jwt = require("jsonwebtoken");
const morgan = require("morgan");
const port = process.env.port || 5000;
// middleware
const corsOptions = {
  origin: ["http://localhost:3000", "http://localhost:3001"],
  credentials: true,
  optionSuccessStatus: 200,
};
app.use(cors(corsOptions));
app.use(express.json());
app.use(cookieParser());
app.use(morgan("dev"));
app.use(express.json());

const verifyToken = async (req, res, next) => {
  const token = req.cookies?.token;
  console.log("cookies", req.cookies);
  if (!token) {
    return res.status(401).send({ message: "unauthorized access" });
  }
  jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
    if (err) {
      console.log(err);
      return res.status(401).send({ message: "unauthorized access" });
    }
    req.user = decoded;
    next();
  });
};

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(process.env.MONGODB_URI, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  const database = client.db("as-programming-db");
  const usersCollection = database.collection("users");
  const courseCollection = database.collection("courses");
  const admissionCollection = database.collection("admissions");
  const cartCollection = database.collection("cart");

  // Role Verifaction Middlewares
  // For Admins
  const verifyAdmin = async (req, res, next) => {
    try {
      const user = req.user;

      if (!user || !user.email) {
        console.log("No user or email in request");
        return res.status(401).send({ message: "Unauthorized access" });
      }

      const query = { email: user.email };
      const result = await usersCollection.findOne(query);

      if (!result) {
        console.log("No user found with the given email");
        return res.status(401).send({ message: "Unauthorized access" });
      }

      if (result.role !== "admin") {
        console.log(`User role is ${result.role}, not admin`);
        return res.status(401).send({ message: "Unauthorized access" });
      }

      console.log("User is verified as admin");
      next();
    } catch (error) {
      console.error("Error in verifyAdmin middleware:", error);
      return res.status(500).send({ message: "Internal Server Error" });
    }
  };
  // for teachers
  const verifyTeacher = async (req, res, next) => {
    try {
      const user = req.user;

      if (!user || !user.email) {
        console.log("No user or email in request");
        return res.status(401).send({ message: "Unauthorized access" });
      }

      const query = { email: user.email };
      const result = await usersCollection.findOne(query);

      if (!result) {
        console.log("No user found with the given email");
        return res.status(401).send({ message: "Unauthorized access" });
      }

      if (result.role !== "teacher") {
        console.log(`User role is ${result.role}, not teacher`);
        return res.status(401).send({ message: "Unauthorized access" });
      }

      console.log("User is verified as teacher");
      next();
    } catch (error) {
      console.error("Error in verify Teacher middleware:", error);
      return res.status(500).send({ message: "Internal Server Error" });
    }
  };
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();
    // Auth related api
    app.post("/jwt", async (req, res) => {
      const user = req.body;
      console.log("I need a new jwt", user);
      const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, {
        expiresIn: "365d", // 1 year
      });
      res
        .cookie("token", token, {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: process.env.NODE_ENV === "production" ? "none" : "strict",
        })
        .send({ success: true });
    });

    //Logout
    app.get("/logout", async (req, res) => {
      try {
        res
          .clearCookie("token", {
            maxAge: 0,
            secure: process.env.NODE_ENV === "production",
            sameSite: process.env.NODE_ENV === "production" ? "none" : "strict",
          })
          .send({ success: true });
        console.log("Logged out successfully");
      } catch (error) {
        res.status(500).send({ message: error.message });
      }
    });

    // Save or modify user email, status in db and become a teacher
    app.put("/users/:email", async (req, res) => {
      const email = req.params.email;
      const user = req.body;
      const query = { email: email };
      const options = { upsert: true };
      const isExist = await usersCollection.findOne(query);

      if (isExist) {
        if (user.status === "requested") {
          const updatedDoc = {
            $set: {
              status: "requested",
            },
          };
          const result = await usersCollection.updateOne(
            query,
            updatedDoc,
            options
          );
          res.send(result);
        } else {
          return res.send({ message: "Already a teacher" });
        }
      } else {
        const result = await usersCollection.updateOne(
          query,
          { $set: { ...user, timestamp: new Date() } },
          options
        );
        res.send(result);
      }
    });

    // get user role
    app.get("/user/:email", async (req, res) => {
      const email = req.params.email;

      const result = await usersCollection.findOne({ email });

      if (!result) {
        return res.status(404).json({ error: "User not found" });
      }
      res.send(result);
    });
    // Get All Courses
    app.get("/courses", async (req, res) => {
      try {
        const limit = parseInt(req.query.limit) || 10;
        const skip = parseInt(req.query.skip) || 0; // Adjust skip calculation

        const result = await courseCollection
          .find()
          .skip(skip)
          .limit(limit)
          .toArray();

        res.send({ result });
      } catch (error) {
        res.status(500).json({ error: "Internal Server Error" });
      }
    });

    // Get Single Course
    app.get("/course/:id", async (req, res) => {
      const { id } = req.params;
      console.log("this is id of =======>", id);
      if (!ObjectId.isValid(id)) {
        return res.status(400).json({ error: "Invalid ID format" });
      }

      const query = { _id: new ObjectId(id) };

      try {
        const result = await courseCollection.findOne(query);
        if (!result) {
          return res.status(404).json({ message: "Course not found" });
        }
        res.status(200).json(result);
      } catch (error) {
        console.error("Error fetching course:", error);
        res.status(500).json({ error: "Internal Server Error" });
      }
    });

    // Get All Courses For Teacher
    app.get("/courses/:email", async (req, res) => {
      const email = req.params.email;
      const query = { "teacher.email": email };
      const result = await courseCollection.find(query).toArray();
      if (result.length === 0) {
        return res.send({ message: "No courses found" });
      }
      res.send(result);
    });

    // Get Begginers Courses
    app.get("/beginners", async (req, res) => {
      try {
        const result = await courseCollection
          .find({ level: "Beginner" })
          .toArray();
        res.send(result);
      } catch (error) {
        res.status(500).json({ error: "Internal Server Error" });
      }
    });

    // Save course in database
    app.post("/course", async (req, res) => {
      const course = req.body;
      const result = await courseCollection.insertOne(course);
      res.send(result);
    });

    // Save Course for user || CART
    app.post("/cart", async (req, res) => {
      const { courseId, userEmail } = req.body;
      console.log(courseId, userEmail);
      if (!ObjectId.isValid(courseId)) {
        return res.status(400).json({ message: "Invalid courseId" });
      }
      const courseObjectId = new ObjectId(courseId);
      const cartItem = {
        email: userEmail,
        courseId: courseObjectId,
      };

      try {
        const existingItem = await cartCollection.findOne(cartItem);
        if (existingItem) {
          return res
            .status(400)
            .json({ message: "Course is already in the cart" });
        }

        const result = await cartCollection.insertOne(cartItem);
        res.status(201).send(result);
      } catch (error) {
        console.error("Error adding to cart:", error);
        res.status(500).json({ error: "Internal Server Error" });
      }
    });

    // Get user cart items
    app.get("/cart/:email", async (req, res) => {
      const { email } = req.params;
      try {
        const cartItems = await cartCollection.find({ email }).toArray();
        const courseIds = cartItems.map((item) => item.courseId);
        const courses = await courseCollection
          .find({ _id: { $in: courseIds } })
          .toArray();
        res.status(200).json(courses);
      } catch (error) {
        console.error("Error fetching cart items:", error);
        res.status(500).json({ error: "Internal Server Error" });
      }
    });

    // Delete course from cart
    app.delete("/cart", async (req, res) => {
      const { email, courseId } = req.body;

      if (!ObjectId.isValid(courseId)) {
        return res.status(400).json({ message: "Invalid courseId" });
      }
      const courseObjectId = new ObjectId(courseId);
      const cartItem = {
        email,
        courseId: courseObjectId,
      };

      try {
        const result = await cartCollection.deleteOne(cartItem);
        if (result.deletedCount === 0) {
          return res.status(404).json({ message: "Course not found in cart" });
        }
        res.status(200).send(result);
      } catch (error) {
        console.error("Error removing from cart:", error);
        res.status(500).json({ error: "Internal Server Error" });
      }
    });

    // update user cover image in db
    app.put("/user/cover/:email", async (req, res) => {
      const email = req.params.email;
      const user = req.body;
      console.log(user);
      const query = { email: email };
      const options = { upsert: true };
      const updatedDoc = {
        $set: {
          coverImg: user.coverImage,
        },
      };
      const result = await usersCollection.updateOne(
        query,
        updatedDoc,
        options
      );
      res.send(result);
    });

    // Get all users from db
    app.get("/users", async (req, res) => {
      const result = await usersCollection.find().toArray();
      res.send(result);
    });

    // update user role
    app.put("/users/update/:email", async (req, res) => {
      const email = req.params.email;
      const user = req.body;
      const query = { email: email };
      const options = { upsert: true };
      const updatedDoc = {
        $set: {
          ...user,
          timestamp: Date.now(),
        },
      };
      const result = await usersCollection.updateOne(
        query,
        updatedDoc,
        options
      );
      res.send(result);
    });

    // remove course from db
    app.delete("/course/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await courseCollection.deleteOne(query);
      res.send(result);
    });

    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Hello World!");
});

app.listen(port, () => {
  console.log(`Example app listening at http://localhost:${port}`);
});
