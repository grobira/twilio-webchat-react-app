const axios = require("axios");

const logsPath = Runtime.getAssets()['/logs.js'].path;
const { logFinalAction, logInitialAction, logInterimAction } = require(logsPath);

const createTokenPath = Runtime.getAssets()['/createToken.js'].path;
const { createToken } = require(createTokenPath);

const { TOKEN_TTL_IN_SECONDS, ADDRESS_SID, ACCOUNT_SID, AUTH_TOKEN } = process.env;

exports.handler = async (context, event, callback) => {

    logInitialAction("Initiating webchat");
    const twilioClient = context.getTwilioClient()

    const response = new Twilio.Response();
    response.appendHeader('Access-Control-Allow-Origin', '*');
    response.appendHeader('Access-Control-Allow-Methods', 'OPTIONS POST GET');
    response.appendHeader('Access-Control-Allow-Headers', 'Content-Type');
    response.appendHeader('Content-Type', 'application/json');

    const customerFriendlyName = event.formData?.friendlyName || "Customer";

    let conversationSid;
    let identity;

    // Hit Webchat Orchestration endpoint to generate conversation and get customer participant sid
    try {
        const result = await contactWebchatOrchestrator(event, customerFriendlyName);
        ({ identity, conversationSid } = result);
    } catch (error) {
        response.setStatusCode(500);
        response.setBody({ errorMessage: `Couldn't initiate WebChat: ${error?.message}` })
        callback(response)
    }

    // Generate token for customer
    const token = createToken(identity);

    // OPTIONAL — if user query is defined
    if (event.formData?.query) {
        // use it to send a message in behalf of the user with the query as body
        await sendUserMessage(twilioClient, conversationSid, identity, event.formData.query).then(() =>
            // and then send another message from Concierge, letting the user know that an agent will help them soon
            sendWelcomeMessage(twilioClient, conversationSid, customerFriendlyName)
        );
    }

    response.setBody({
        token,
        conversationSid,
        expiration: Date.now() + TOKEN_TTL_IN_SECONDS * 1000
    });

    logFinalAction("Webchat successfully initiated");

    callback(null, response);
}


const contactWebchatOrchestrator = async (request, customerFriendlyName) => {
    logInterimAction("Calling Webchat Orchestrator");

    const params = new URLSearchParams();
    params.append("AddressSid", ADDRESS_SID);
    params.append("ChatFriendlyName", "Webchat widget");
    params.append("CustomerFriendlyName", customerFriendlyName);
    params.append(
        "PreEngagementData",
        JSON.stringify({
            ...request.formData,
            friendlyName: customerFriendlyName
        })
    );

    let conversationSid;
    let identity;

    try {
        const res = await axios.post(`https://flex-api.twilio.com/v2/WebChats`, params, {
            auth: {
                username: ACCOUNT_SID,
                password: AUTH_TOKEN
            }
        });
        ({ identity, conversation_sid: conversationSid } = res.data);
    } catch (e) {
        logInterimAction("Something went wrong during the orchestration:", e.response?.data?.message);
        throw e.response.data;
    }

    logInterimAction("Webchat Orchestrator successfully called");

    return {
        conversationSid,
        identity
    };
};

const sendUserMessage = (twilioClient, conversationSid, identity, messageBody) => {
    logInterimAction("Sending user message");
    return twilioClient
        .conversations.conversations(conversationSid)
        .messages.create({
            body: messageBody,
            author: identity,
            xTwilioWebhookEnabled: true // trigger webhook
        })
        .then(() => {
            console.log("User message sent")
            logInterimAction("(async) User message sent");
        })
        .catch((e) => {
            console.log("error", e)

            logInterimAction(`(async) Couldn't send user message: ${e?.message}`);
        });
};

const sendWelcomeMessage = (twilioClient, conversationSid, customerFriendlyName) => {
    logInterimAction("Sending welcome message");
    return twilioClient
        .conversations.conversations(conversationSid)
        .messages.create({
            body: `Welcome ${customerFriendlyName}! An agent will be with you in just a moment.`,
            author: "Concierge"
        })
        .then(() => {
            logInterimAction("(async) Welcome message sent");
        })
        .catch((e) => {
            logInterimAction(`(async) Couldn't send welcome message: ${e?.message}`);
        });
};