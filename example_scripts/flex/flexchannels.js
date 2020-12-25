require('dotenv').config();
var express = require('express');
var router = express.Router();
const model = require('./channelproxy');


router.use('/channel-update', function(req, res, next) {
  console.log("Got channel update: ", req.body);
  const channelSid = req.body.ChannelSid;
  model.handleChannelUpdate(channelSid, req.body);
  res.sendStatus(200);
});

router.use('/new-message', function(req, res, next) {
  model.handleChatMessage(req.body.ChannelSid, req.body);
  res.sendStatus(200);
});

exports.router = router;