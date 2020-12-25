
require('dotenv').config();
const fetch = require('node-fetch');
const request = require('request-promise')
const auth = require('../helpers/auth.js')


// Flex channel SID to Twitter user ID mapping
var channelMapping = {};

// Twitter user ID mapping to an object that contains the Flex channel SID among other things
var remoteChannelMappings = {}

const client = require('twilio')(
    process.env.TWIL_FLEX_ACCOUNT_SID,
    process.env.TWIL_FLEX_ACCOUNT_KEY
  );

function removeMapping(channelSid) {
    if ( !(channelSid in channelMapping) ) {
        console.log(`Didnt find channel mapping for ${channelSid}`);
        return;
    }

    console.log(`Cleaning up for channels with sid ${channelSid}`);

    const remoteId = channelMapping[channelSid];
    delete remoteChannelMappings[remoteId]
    delete channelMapping[channelSid];
}

function sendChatMessage(serviceSid, channelSid, chatUserName, body) {
    console.log(`Sending new chat message ${chatUserName}, ${channelSid}, ${body}`);
    const params = new URLSearchParams();
    params.append('Body', body);
    params.append('From', chatUserName);
    var auth = Buffer.from(`${process.env.TWIL_FLEX_ACCOUNT_SID}:${process.env.TWIL_FLEX_ACCOUNT_KEY}`).toString('base64');
    return fetch(
      `https://chat.twilio.com/v2/Services/${serviceSid}/Channels/${channelSid}/Messages`,
      {
        method: 'post',
        body: params,
        headers: {
          'X-Twilio-Webhook-Enabled': 'true',
          Authorization: `Basic ${auth}`
        }
      }
    );
  }


async function createNewChannel(flexFlowSid, flexChatService, chatUserName) {
  console.log(`Creating new channel for ${chatUserName}`);
    return client.flexApi.channel
      .create({
        // flexFlowSid: process.env.FLEX_FLOW_SID,
        flexFlowSid: flexFlowSid,
        identity: chatUserName,
        chatUserFriendlyName: chatUserName,
        chatFriendlyName: 'Flex Custom Chat',
        target: chatUserName
      })
      .then(channel => {
        console.log(`Created new channel ${channel.sid}`);
  
        client.chat.services(flexChatService)
        .channels(channel.sid)
        .webhooks
        .list({limit: 20})
        .then(webhooks => webhooks.forEach(w => {
          console.log(`deleting ${w.sid}`);
          //deleteWebhook(flexChatService, channel.sid, w.sid);
        }));
  
        return client.chat
          .services(flexChatService)
          .channels(channel.sid)
          .webhooks.create({
            type: 'webhook',
            'configuration.method': 'POST',
            'configuration.url': `${process.env.WEBHOOK_BASE_URL}/message-events/new-message?channel=${channel.sid}`,
            'configuration.filters': ['onMessageSent']
          })
          .then(() => client.chat
          .services(flexChatService)
          .channels(channel.sid)
          .webhooks.create({
            type: 'webhook',
            'configuration.method': 'POST',
            'configuration.url': `${process.env.WEBHOOK_BASE_URL}/message-events/channel-update`,
            'configuration.filters': ['onChannelUpdated']
          }))
      })
      .then(webhook => webhook.channelSid)
      .catch(error => {
        console.log(error);
      });
  }

// When a Twitter DM is received this method will create and use the Flex Channel to forward the message to
async function handleRemoteChannelMessage( remoteId, remoteName, message, senderFunc) {
  if ( !(remoteId in remoteChannelMappings)) {
    console.log(`Didnt find ${remoteId} in my ${remoteChannelMappings}`);
    const channelCreate = createNewChannel(
      process.env.FLEX_FLOW_SID,
      process.env.FLEX_CHAT_SERVICE,
      remoteName+'@'+remoteId
    );

    remoteChannelMappings[remoteId] = { "channelCreate": channelCreate };
  } else {
    console.log(`Found ${remoteId} in my `, remoteChannelMappings);
  }

  const channelSid = await remoteChannelMappings[remoteId].channelCreate;
  console.log(`Got channel ${channelSid}`);

  remoteChannelMappings[remoteId].flexChannelSid = channelSid;
  remoteChannelMappings[remoteId].senderFunc = senderFunc;

  channelMapping[channelSid] = remoteId;
  sendChatMessage(
    process.env.FLEX_CHAT_SERVICE,
    channelSid,
    remoteName,
    message
  );
}

async function handleTwitterEvent(e) {
  if (!("direct_message_events" in e) ) {
    console.debug("Got event:", e)
    return;
  }

  const events = e.direct_message_events;
  events.forEach( e => {
    if ( "message_create" in e) {
      const senderId = e.message_create.sender_id;
      const msg = e.message_create.message_data.text;
      
      handleRemoteChannelMessage(senderId, senderId, msg, function(msg) {
        console.log("Twitter sender func is not implemented for ", senderId, msg);

        const doc =  { "event": {
          "type": "message_create", 
            "message_create": {
               "target": {
                  "recipient_id": senderId
                },
                "message_data": {"text": "Hello World!"}}}}

        var request_options = {
          url: 'https://api.twitter.com/1.1/direct_messages/events/new.json',
          oauth: auth.twitter_oauth,
          body: doc,
          json: true
        }
    
        return request.post(request_options)
      });
    }
  });
}

// This is called when a Flex Chat message is received. It simply finds the Twitter user mapping and forwards the message to that user
async function handleChatMessage(channelSid, msgData) {
  if ( !("EventType" in msgData) || msgData.EventType !== "onMessageSent" || msgData.Source !== "SDK") {
    console.log("Dropping event ", msgData);
    return;
  }
  if ( !(channelSid in channelMapping)) {
    console.log("Got an event on a channel that I dont have a record of", channelSid);
    return;
  }

  const r = await remoteChannelMappings[channelMapping[channelSid]].senderFunc(msgData).catch( err => {
    console.log("Got error ", err);
  });
  console.log("Got val");
}

// When an agent closes the chat session, we remove the mapping
function handleChannelUpdate(channelSid, msgData) {
    const attributes = JSON.parse(msgData.Attributes);
    if ( attributes.status == 'INACTIVE') {
      if ( channelSid in channelMapping) {
        console.log(`Found channel sid ${channelSid} in channelMappings`);
        removeMapping(channelSid);
      } else {
        console.log(`Didnt find channel sid ${channelSid} in channelMappings`);
      }
    }
}

module.exports.handleChatMessage = handleChatMessage;
module.exports.handleChannelUpdate = handleChannelUpdate;
module.exports.handleTwitterEvent = handleTwitterEvent;

