const express = require("express");
const router = express.Router();
const linkController = require("../controllers/linkController");

router.post("/create", linkController.createShortDeepLink);
router.get("/:shortId", linkController.redirectShortLink);

module.exports = router;
