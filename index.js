const express = require("express");
const app = express();
require("dotenv").config();
const cors = require("cors");
const cookieParser = require("cookie-parser");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const jwt = require("jsonwebtoken");
const morgan = require("morgan");
const SSLCommerzPayment = require("sslcommerz-lts");
const port = process.env.port || 5000;
// middleware
const corsOptions = {
  origin: [
    "http://localhost:3000",
    "http://localhost:3001",

    "https://as-programming-client.onrender.com",
  ],
  credentials: true,
  optionSuccessStatus: 200,
};
app.use(cors(corsOptions));
app.use(express.json());
app.use(cookieParser());
app.use(morgan("dev"));
app.use(express.json());

const store_id = process.env.STORE_ID;
const store_passwd = process.env.STORE_ID_PASS;
const is_live = false; //true for live, false for sandbox
const verifyToken = async (req, res, next) => {
  const token = req.cookies?.token;
  console.log("this is token=========>", token);
  if (!token) {
    return res
      .status(401)
      .send({ message: "unauthorized access token not found" });
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
  const assignmentsCollection = database.collection("assignments");
  const bookmarksCollection = database.collection("bookmarks");

  // Role Verifaction Middlewares
  // For Admins
  const verifyAdmin = async (req, res, next) => {
    try {
      const user = req.user;
      console.log(req.user);
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
    // Auth related API
    app.post("/jwt", async (req, res) => {
      try {
        const user = req.body;
        console.log("I need a new jwt", user);
        const payload = { email: user?.email, role: user?.role };
        // Generate JWT token
        const token = jwt.sign(payload, process.env.ACCESS_TOKEN_SECRET, {
          expiresIn: "1d", // 1 days, consider reducing this
        });

        // Set the JWT token in an HTTP-only cookie
        res
          .cookie("token", token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === "production",
            sameSite: "none",
            maxAge: 24 * 60 * 60 * 1000, // 1 days
          })
          .send({ success: true, token });
      } catch (error) {
        console.error("Failed to generate JWT:", error);
        res
          .status(500)
          .send({ success: false, message: "Failed to generate JWT" });
      }
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
          { $set: { ...user, timestamp: Date.now() } },
          options
        );
        res.send(result);
      }
    });

    // get user details
    app.get("/user/:email", verifyToken, async (req, res) => {
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
        console.log('Fetching courses with status "approved"');
        const result = await courseCollection
          .find({ status: "Approved" })
          .skip(skip)
          .limit(limit)
          .toArray();
        console.log("Result:", result);
        res.send({ result });
      } catch (error) {
        res.status(500).json({ error: "Internal Server Error" });
      }
    });
    // Get All Courses for Admin
    app.get("/courses/admin", verifyToken, verifyAdmin, async (req, res) => {
      try {
        const result = await courseCollection.find().toArray();
        res.send(result);
      } catch (error) {
        console.log(error);
        res.status(500).json({ error: "Internal Server Error" });
      }
    });

    // Update course status for admin
    app.put(
      "/course/status/:id",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        const id = req.params.id;

        try {
          const result = await courseCollection.updateOne(
            { _id: new ObjectId(id) },
            { $set: { status: "Approved" } }
          );
          res.send(result);
        } catch (error) {
          console.log(error);
          res.status(500).json({ error: "Internal Server Error" });
        }
      }
    );
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

    // Update Course for teacher
    app.put("/course/:id", verifyToken, verifyTeacher, async (req, res) => {
      const id = req.params.id;
      const updatedCourse = req.body;

      try {
        const result = await courseCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: updatedCourse }
        );

        res.send(result);
      } catch (error) {
        console.error(error);
      }
    });
    // Get All Bookmarks for student
    app.get("/bookmarks/:email", verifyToken, async (req, res) => {
      const { email } = req.params;
      try {
        const bookmarksItems = await bookmarksCollection
          .find({ email })
          .toArray();
        const courseIds = bookmarksItems.map((item) => item.courseId);
        const courses = await courseCollection
          .find({ _id: { $in: courseIds } })
          .toArray();
        res.status(200).json(courses);
      } catch (error) {
        console.error("Error fetching cart items:", error);
        res.status(500).json({ error: "Internal Server Error" });
      }
    });
    // Save Course in bookmarks for student
    app.post("/bookmarks", verifyToken, async (req, res) => {
      const { courseId, userEmail } = req.body;
      console.log(courseId, userEmail);
      if (!ObjectId.isValid(courseId)) {
        return res.status(400).json({ message: "Invalid courseId" });
      }
      const courseObjectId = new ObjectId(courseId);
      const bookmarkItem = {
        email: userEmail,
        courseId: courseObjectId,
      };

      try {
        const existingItem = await bookmarksCollection.findOne(bookmarkItem);
        if (existingItem) {
          return res
            .status(400)
            .json({ message: "Course is already in the Bookmarks" });
        }

        const result = await bookmarksCollection.insertOne(bookmarkItem);
        res.status(201).send(result);
      } catch (error) {
        console.error("Error adding to bookmarks:", error);
        res.status(500).json({ error: "Internal Server Error" });
      }
    });

    // Remove Course From Bookmarks

    app.delete("/bookmarks", async (req, res) => {
      const { courseId, email } = req.body;
      console.log(email, courseId);
      if (!ObjectId.isValid(courseId)) {
        return res.status(400).json({ message: "Invalid courseId" });
      }
      const courseObjectId = new ObjectId(courseId);
      const bookmarkItem = {
        email,
        courseId: courseObjectId,
      };

      try {
        const result = await bookmarksCollection.deleteOne(bookmarkItem);
        if (result.deletedCount === 0) {
          return res
            .status(404)
            .json({ message: "Course not found in bookmarks" });
        }
        res.status(200).send(result);
      } catch (error) {
        console.error("Error removing from bookmarks:", error);
        res.status(500).json({ error: "Internal Server Error" });
      }
    });
    // Get All Courses For Teacher
    app.get("/courses/:email", verifyToken, verifyTeacher, async (req, res) => {
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
          .find({ level: "Beginner", status: "Approved" })
          .toArray();
        res.send(result);
      } catch (error) {
        res.status(500).json({ error: "Internal Server Error" });
      }
    });

    // Get Assignment for student
    app.get("/assignments/student/:email", verifyToken, async (req, res) => {
      try {
        const email = req.params.email;
        if (!email) {
          res.status(404).json({ message: "email not found" });
        }
        const query = { studentEmail: email };
        const result = await assignmentsCollection.find(query).toArray();
        res.send(result);
      } catch (error) {
        console.log(error);
      }
    });
    // Get Assignment teacher
    app.get(
      "/assignments/teacher/:email",
      verifyToken,
      verifyTeacher,
      async (req, res) => {
        try {
          const email = req.params.email;
          if (!email) {
            res.status(404).json({ message: "email not found" });
          }
          const query = { teacherEmail: email };
          const result = await assignmentsCollection.find(query).toArray();
          res.send(result);
        } catch (error) {
          console.log(error);
        }
      }
    );

    // update assignment
    app.put(
      "/assignments/teacher/:id",
      verifyToken,
      verifyTeacher,
      async (req, res) => {
        const id = req.params.id;
        const query = { _id: new ObjectId(id) };
        const assignmentData = req.body;
        console.log(assignmentData);

        // handle the update here
        try {
          const result = await assignmentsCollection.updateOne(
            query,
            {
              $set: {
                mark: assignmentData.mark,
                feedback: assignmentData.feedback,
              },
            },
            { upsert: false } // If the assignment doesn't exist, insert it
          );

          if (result.modifiedCount === 0) {
            return res
              .status(404)
              .send({ message: "Assignment not found or no changes made" });
          }

          res
            .status(200)
            .send({ message: "Assignment updated successfully", result });
        } catch (error) {
          console.error("Error updating assignment:", error);
          res.status(500).send({ message: "Internal Server Error" });
        }
      }
    );

    // Save course in database
    app.post("/course", verifyToken, verifyTeacher, async (req, res) => {
      const course = req.body;
      const result = await courseCollection.insertOne(course);
      res.send(result);
    });

    // Save Assignment on db
    app.post("/assignments", verifyToken, async (req, res) => {
      const { assignment } = req.body;
      const result = await assignmentsCollection.insertOne({
        ...assignment,
        timestamp: Date.now(),
      });
      res.send(result);
    });

    // Save Course for user || CART
    app.post("/cart", verifyToken, async (req, res) => {
      const { courseId, userEmail } = req.body;

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
    app.get("/cart/:email", verifyToken, async (req, res) => {
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
    app.delete("/cart", verifyToken, async (req, res) => {
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
    // Get payment info for admin
    app.get("/admin/payment", verifyToken, verifyAdmin, async (req, res) => {
      try {
        const result = await admissionCollection.find().toArray();
        res.send(result);
      } catch (error) {
        console.error("Error fetching payment info:", error);
        res.status(500).json({ error: "Internal Server Error" });
      }
    });
    // Delete admission data from db
    app.delete(
      "/delete/admission/:id",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        const id = req.params.id;
        const query = { _id: new ObjectId(id) };
        try {
          const result = await admissionCollection.deleteOne(query);
          res.send(result);
        } catch (error) {
          console.error("Error deleting admission data:", error);
          res.status(500).json({ error: "Internal Server Error" });
        }
      }
    );
    // Remove Assignment from db for admin
    app.delete(
      "/remove/assignment/:email",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        const email = req.params.email;
        const query = { studentEmail: email };
        try {
          const result = await assignmentsCollection.deleteMany(query);
          res.send(result);
        } catch (error) {
          console.error("Error deleting assignment data:", error);
          res.status(500).json({ error: "Internal Server Error" });
        }
      }
    );
    // update user cover image in db
    app.put("/user/cover/:email", verifyToken, async (req, res) => {
      const email = req.params.email;
      const currentUser = req.body;
      console.log(currentUser);
      try {
        const query = { email: email };
        const options = { upsert: true };
        const updatedDoc = {
          $set: {
            coverImg: currentUser?.coverImg,
          },
        };
        const result = await usersCollection.updateOne(
          query,
          updatedDoc,
          options
        );
        res.send(result);
      } catch (error) {
        console.error("Error updating cover image:", error);
        res
          .status(500)
          .send({ success: false, message: "Internal server error" });
      }
    });

    // Get all users from db
    app.get("/users", verifyToken, verifyAdmin, async (req, res) => {
      const result = await usersCollection.find().toArray();
      res.send(result);
    });

    // update user role
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

    // remove course from db
    app.delete("/course/:id", verifyToken, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await courseCollection.deleteOne(query);
      res.send(result);
    });

    // Get Admission course with pagination
    app.get("/admissions/:email", verifyToken, async (req, res) => {
      const email = req.params.email;

      try {
        const result = await admissionCollection.find({ email }).toArray();

        res.send(result);
      } catch (error) {
        console.log("Fetching an Error on the Server");
        res.status(500).json({ error: "Internal Error" });
      }
    });

    // Get Admissions course by id
    app.get("/admissions/course/:id", async (req, res) => {
      const id = req.params.id;
      console.log("the id is =========> ", id);

      const result = courseCollection.findOne({ _id: new ObjectId(id) });
      res.send(result);
    });

    // sslcommerz payment gateway
    app.post("/order", verifyToken, async (req, res) => {
      const { email, courseInfo, shippingDetails } = req.body;
      // Extract course IDs from courseInfo
      const courseIds = courseInfo.map((course) => course.courseId);

      // Generate a unique transaction ID
      const tran_id = new ObjectId().toString();

      // Prepare data for SSLCommerz
      const data = {
        total_amount: shippingDetails.totalAmount,
        currency: "BDT",
        tran_id: tran_id,
        success_url: `http://localhost:5000/payment/success/${tran_id}`,
        fail_url: "http://localhost:3030/fail",
        cancel_url: "http://localhost:3030/cancel",
        ipn_url: "http://localhost:3030/ipn",
        shipping_method: "Courier",
        product_name: "Course",
        product_category: "IT",
        product_profile: "general",
        cus_name: `${shippingDetails.fullName}`,
        cus_email: "Dhaka Mohammadpur",
        cus_add1: "Dhaka Mohammadpur",
        cus_add2: "Dhaka Mohammadpur",
        cus_city: "Dhaka Mohammadpur",
        cus_state: "Dhaka Mohammadpur",
        cus_postcode: "1207",
        cus_country: "Bangladesh",
        cus_phone: "01719681150",
        cus_fax: "01719681150",
        ship_name: `${shippingDetails.fullName}`,
        ship_add1: "Dhaka Mohammadpur",
        ship_add2: "Dhaka Mohammadpur",
        ship_city: "Dhaka Mohammadpur",
        ship_state: "Dhaka Mohammadpur",
        ship_postcode: "1207",
        ship_country: "Bangladesh",
      };

      // Initialize SSLCommerzPayment instance
      const sslcz = new SSLCommerzPayment(store_id, store_passwd, is_live);

      try {
        // Initialize the payment
        const apiResponse = await sslcz.init(data);

        // Ensure GatewayPageURL or equivalent property exists in apiResponse
        if (apiResponse && apiResponse.GatewayPageURL) {
          const GatewayPageURL = apiResponse.GatewayPageURL;

          // Save order details in the database
          const order = {
            email,
            courseInfo,
            date: Date.now(),
            data,
            paymentStatus: false,
            transaction_id: tran_id,
          };
          const result = await admissionCollection.insertOne(order);

          if (result.insertedId) {
            // Remove courses from the cart
            const removeResult = await cartCollection.deleteMany({
              email: email,
              courseId: { $in: courseIds },
            });
            console.log(removeResult);

            res.send({ url: GatewayPageURL });
            console.log("Redirecting to:", GatewayPageURL);
          }
        } else {
          console.error("GatewayPageURL not found in API response");
          res
            .status(500)
            .json({ error: "GatewayPageURL not found in API response" });
        }
      } catch (err) {
        console.error("SSLCommerz initialization error:", err);
        res.status(500).json({ error: "Failed to initialize payment" });
      }
      // Payment success route
      app.post("/payment/success/:tranId", async (req, res) => {
        const transId = req.params.tranId;
        const result = await admissionCollection.updateOne(
          { transaction_id: transId },
          {
            $set: {
              paymentStatus: true,
            },
          }
        );

        if (result.modifiedCount > 0) {
          const deleteResult = await cartCollection.deleteMany({
            email,
            _id: { $in: courseIds.map((id) => new ObjectId(id)) },
          });
          if (deleteResult.deletedCount === courseIds.length) {
            console.log("Courses removed from cart:", deleteResult);
          } else {
            console.error("Some courses were not removed from the cart");
          }
          console.log(result);
          res.redirect("http://localhost:3000/dashboard/courses");
        } else {
          res.status(500).json({ error: "Failed to update payment status" });
        }
      });
    });

    // ==========> Statistics <=============
    //==== For Teacher======
    // Get Nubmer Of Courses added by a teacher
    app.get(
      "/teacher/:email/courses/count",
      verifyToken,
      verifyTeacher,
      async (req, res) => {
        const email = req.params.email;
        try {
          const courseCount = await courseCollection.countDocuments({
            "teacher.email": email,
          });
          res.status(200).json({ courseCount });
        } catch (error) {
          res.status(500).json({ error: "Internal Server Error" });
        }
      }
    );
    // Get earnings for each course added by a teacher
    app.get(
      "/teacher/:email/earnings",
      verifyToken,
      verifyTeacher,
      async (req, res) => {
        const email = req.params.email;

        try {
          const earnings = await admissionCollection
            .aggregate([
              {
                $match: {
                  "courseInfo.teacherEmail": email,
                  paymentStatus: true,
                },
              },
              {
                $group: {
                  _id: "$_id",
                  totalEarnings: { $first: "$data.total_amount" },
                },
              },
              {
                $group: {
                  _id: null,
                  totalEarnings: { $sum: "$totalEarnings" },
                },
              },
            ])
            .toArray();

          res
            .status(200)
            .json({ totalEarnings: earnings[0]?.totalEarnings || 0 });
        } catch (error) {
          res.status(500).json({ error: "Internal Server Error" });
        }
      }
    );

    // Get total students who purchased courses from a specific teacher

    app.get(
      "/teacher/:email/students/count",
      verifyToken,
      verifyTeacher,
      async (req, res) => {
        const email = req.params.email;
        try {
          const studentCount = await admissionCollection
            .aggregate([
              {
                $match: {
                  "courseInfo.teacherEmail": email,
                  paymentStatus: true,
                },
              },
              { $group: { _id: "$email" } },
              { $count: "totalStudents" },
            ])
            .toArray();
          res
            .status(200)
            .json({ totalStudents: studentCount[0]?.totalStudents || 0 });
        } catch (error) {
          res.status(500).json({ error: "Internal Server Error" });
        }
      }
    );

    // Get total assignment for teacher
    app.get(
      "/teacher/:email/assignment/count",
      verifyToken,
      verifyTeacher,
      async (req, res) => {
        const email = req.params.email;
        try {
          const assignmentCount = await assignmentsCollection.countDocuments({
            teacherEmail: email,
          });
          res.status(200).json({ assignmentCount });
        } catch (error) {
          res.status(500).json({ error: "Internal Server Error" });
        }
      }
    );
    // Get earnings over time for a teacher
    app.get(
      "/teacher/:email/earnings/history",
      verifyToken,
      verifyTeacher,
      async (req, res) => {
        const email = req.params.email;
        try {
          const earningsHistory = await admissionCollection
            .aggregate([
              {
                $match: {
                  "courseInfo.teacherEmail": email,
                  paymentStatus: true,
                },
              },
              {
                $group: {
                  _id: "$data.tran_id",
                  date: { $first: "$date" },
                  amount: { $sum: "$data.total_amount" },
                },
              },
              { $sort: { date: 1 } },
            ])
            .toArray();

          res.status(200).json({ earningsHistory });
        } catch (error) {
          res.status(500).json({ error: "Internal Server Error" });
        }
      }
    );

    // =============>for Student<=============
    // Get assignment marks for a student
    app.get(
      "/student/:email/assignments/marks",
      verifyToken,
      async (req, res) => {
        const email = req.params.email;
        try {
          const assignments = await assignmentsCollection
            .find({ studentEmail: email })
            .toArray();
          const marksDistribution = assignments.reduce((acc, assignment) => {
            const mark = assignment.mark;
            if (acc[mark]) {
              acc[mark]++;
            } else {
              acc[mark] = 1;
            }
            return acc;
          }, {});
          res.status(200).json({ marksDistribution });
        } catch (error) {
          res.status(500).json({ error: "Internal Server Error" });
        }
      }
    );
    // Get number of courses purchased by a student
    app.get(
      "/student/:email/courses/purchased",
      verifyToken,
      async (req, res) => {
        const email = req.params.email;
        try {
          const courseCount = await admissionCollection.countDocuments({
            email,
            paymentStatus: true,
          });
          res.status(200).json({ courseCount });
        } catch (error) {
          res.status(500).json({ error: "Internal Server Error" });
        }
      }
    );

    // Get Number of Assignments Submitted by a student
    app.get(
      "/student/:email/assignments/count",
      verifyToken,
      async (req, res) => {
        const email = req.params.email;
        try {
          const assignmentCount = await assignmentsCollection.countDocuments({
            studentEmail: email,
          });
          res.status(200).json({ assignmentCount });
        } catch (error) {
          res.status(500).json({ error: "Internal Server Error" });
        }
      }
    );
    // Get average mark for assignments of a student
    app.get(
      "/student/:email/assignments/average-mark",
      verifyToken,
      async (req, res) => {
        const email = req.params.email;
        try {
          const assignments = await assignmentsCollection
            .find({ studentEmail: email })
            .toArray();

          // Filter out assignments with 'mark' set to 'pending'
          const validAssignments = assignments.filter(
            (assignment) => assignment.mark !== "pending"
          );

          if (validAssignments.length === 0) {
            return res.status(200).json({ averageMark: 0, batch: "N/A" });
          }

          const totalMarks = validAssignments.reduce(
            (acc, assignment) => acc + parseFloat(assignment.mark),
            0
          );
          const averageMark = totalMarks / validAssignments.length;

          let batch;
          if (averageMark === 60) {
            batch = "A+";
          } else if (averageMark <= 59 && averageMark >= 50) {
            batch = "A";
          } else if (averageMark <= 49 && averageMark >= 40) {
            batch = "B";
          } else if (averageMark <= 39 && averageMark >= 30) {
            batch = "D";
          } else {
            batch = "F";
          }

          res.status(200).json({ averageMark, batch });
        } catch (error) {
          res.status(500).json({ error: "Internal Server Error" });
        }
      }
    );

    //===========> For Admin <===========
    // Get total all user count for admin
    app.get(
      "/admin/users/count",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        try {
          const userCount = await usersCollection.countDocuments();
          res.status(200).json(userCount);
        } catch (error) {
          res.status(500).json({ error: "Internal Server Error" });
        }
      }
    );
    //get total teacher count for admin
    app.get(
      "/admin/teacher/count",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        try {
          const teacherCount = await usersCollection.countDocuments({
            role: "teacher",
          });
          res.status(200).json(teacherCount);
        } catch (error) {
          res.status(500).json({ error: "Internal Server Error" });
        }
      }
    );

    // get total course count for admin
    app.get(
      "/admin/courses/count",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        try {
          const courseCount = await courseCollection.countDocuments();
          res.status(200).json(courseCount);
        } catch (error) {
          res.status(500).json({ error: "Internal Server Error" });
        }
      }
    );

    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
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
