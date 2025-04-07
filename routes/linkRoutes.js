const express = require("express");
const router = express.Router();
const linkController = require("../controllers/linkController");

router.post("/v1/create", linkController.createShortDeepLinkHandler);
router.get("/:shortId", linkController.redirectShortLink);

module.exports = router;
