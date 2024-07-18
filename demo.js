const express = require("express");
const app = express();
require("dotenv").config();
const cors = require("cors");
const cookieParser = require("cookie-parser");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const jwt = require("jsonwebtoken");
const morgan = require("morgan");
const port = process.env.PORT || 8000;
const stripe = require("stripe")(process.env.PAYMENT_SECRET_KEY);
const nodemailer = require("nodemailer");

// middleware
const corsOptions = {
  origin: ["http://localhost:5173", "http://localhost:5174"],
  credentials: true,
  optionSuccessStatus: 200,
};
app.use(cors(corsOptions));
app.use(express.json());
app.use(cookieParser());
app.use(morgan("dev"));

// Send Email
const sendEmail = () => {
  // Create Transporter
  const transporter = nodemailer.createTransport({
    service: "gmail",
    host: "smtp.gmail.com",
    port: 587,
    secure: false,
    requireTLS: true,
    auth: {
      user: process.env.USER,
      pass: process.env.GOOGLE_APP_PASSWORD,
    },
  });

  // verify connection
  transporter.verify(function (error, success) {
    if (error) {
      console.log(error);
    } else {
      console.log("Server is ready to take our messages", success);
    }
  });
};
const verifyToken = async (req, res, next) => {
  const token = req.cookies?.token;
  console.log(token);
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

const client = new MongoClient(process.env.MONGODB_URI, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});
async function run() {
  const database = client.db("stayVista");
  const usersCollection = database.collection("users");
  const roomsCollection = database.collection("rooms");
  const bookingsCollection = database.collection("bookings");
  sendEmail();
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
  // For Host
  const verifyHost = async (req, res, next) => {
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

      if (result.role !== "host") {
        console.log(`User role is ${result.role}, not host`);
        return res.status(401).send({ message: "Unauthorized access" });
      }

      console.log("User is verified as host");
      next();
    } catch (error) {
      console.error("Error in verifyHost middleware:", error);
      return res.status(500).send({ message: "Internal Server Error" });
    }
  };

  try {
    // auth related api
    app.post("/jwt", async (req, res) => {
      const user = req.body;
      console.log("I need a new jwt", user);
      const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, {
        expiresIn: "365d",
      });
      res
        .cookie("token", token, {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: process.env.NODE_ENV === "production" ? "none" : "strict",
        })
        .send({ success: true });
    });

    // Logout
    app.get("/logout", async (req, res) => {
      try {
        res
          .clearCookie("token", {
            maxAge: 0,
            secure: process.env.NODE_ENV === "production",
            sameSite: process.env.NODE_ENV === "production" ? "none" : "strict",
          })
          .send({ success: true });
        console.log("Logout successful");
      } catch (err) {
        res.status(500).send(err);
      }
    });

    // Save or modify user email, status in DB and Become a host
    app.put("/users/:email", async (req, res) => {
      const email = req.params.email;
      const user = req.body;
      const query = { email: email };
      const options = { upsert: true };
      const isExist = await usersCollection.findOne(query);
      console.log("User found?----->", isExist);
      if (isExist) {
        if (user?.status === "requested") {
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
          return res.send(result);
        } else {
          return res.send(isExist);
        }
      }

      const result = await usersCollection.updateOne(
        query,
        {
          $set: { ...user, timestamp: Date.now() },
        },
        options
      );
      res.send(result);
    });

    // Get User Role
    app.get("/user/:email", async (req, res) => {
      const email = req.params.email;
      const result = await usersCollection.findOne({ email });
      console.log(result);
      res.send(result);
    });

    // Get All Rooms
    app.get("/rooms", async (req, res) => {
      const result = await roomsCollection.find().toArray();
      res.send(result);
    });

    // Get Single Rooms for host
    app.get("/room/:id", verifyToken, verifyHost, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await roomsCollection.findOne(query);
      res.send(result);
    });

    // Save Room in Database
    app.post("/rooms", verifyToken, async (req, res) => {
      const room = req.body;
      const result = await roomsCollection.insertOne(room);
      res.send(result);
    });

    // Get Rooms For Host
    app.get("/rooms/:email", verifyToken, verifyHost, async (req, res) => {
      const email = req.params.email;
      const query = { "host.email": email };
      const result = await roomsCollection.find(query).toArray();
      res.send(result);
    });

    // Generate Client Screte for stripe payment
    app.post("/create-payment-intent", verifyToken, async (req, res) => {
      const { price } = req.body;
      const amount = parseInt(price * 100);
      if (!price || amount < 1) return;

      // Create a PaymentIntent with amount and currency
      const paymentIntent = await stripe.paymentIntents.create({
        amount: amount,
        currency: "usd",
        payment_method_types: ["card"],
      });
      res.send({ clientSecret: paymentIntent.client_secret });
    });

    // Save Booking Info In Booking Collection
    app.post("/bookings", verifyToken, async (req, res) => {
      const booking = req.body;
      const result = await bookingsCollection.insertOne(booking);
      // Send Email
      res.send(result);
    });

    // Update Room Bookings Status
    app.patch("/rooms/status/:id", async (req, res) => {
      const id = req.params.id;
      const status = req.body.status;
      const query = { _id: new ObjectId(id) };
      const updateDoc = {
        $set: {
          booked: status,
        },
      };
      const result = await roomsCollection.updateOne(query, updateDoc);
      res.send(result);
    });

    // Get All Bookings For Guest
    app.get("/bookings", verifyToken, async (req, res) => {
      const email = req.query.email;
      if (!email) return res.send([]);
      const query = { "guest.email": email };
      const result = await bookingsCollection.find(query).toArray();

      res.send(result);
    });

    // Get All Bookings For Host
    app.get("/bookings/host", verifyToken, verifyHost, async (req, res) => {
      const email = req.query.email;
      if (!email) return res.send([]);
      const query = { host: email };
      const cursor = bookingsCollection.find(query);
      const result = await cursor.toArray();
      res.send(result);
    });
    // Update User Role
    app.put(
      "/users/update/:email",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
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
      }
    );

    // Get All Users For Admin
    app.get("/users", verifyToken, verifyAdmin, async (req, res) => {
      const result = await usersCollection.find().toArray();
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
  res.send("Hello from StayVista Server..");
});

app.listen(port, () => {
  console.log(`StayVista is running on port ${port}`);
});
