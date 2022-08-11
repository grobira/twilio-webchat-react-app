const axios = require("axios");

const logsPath = Runtime.getAssets()['/logs.js'].path;
const { logFinalAction, logInitialAction, logInterimAction } = require(logsPath);

const createTokenPath = Runtime.getAssets()['/createToken.js'].path;
const { createToken } = require(createTokenPath);

const { TOKEN_TTL_IN_SECONDS, ADDRESS_SID, ACCOUNT_SID, AUTH_TOKEN, FLOW_SID } = process.env;

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
        await sendUserMessage(twilioClient, conversationSid, identity, event.formData.query)
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
    const customerEmail = request.formData?.email.replace(/@/, "");

    let conversationSid;
    let identity;


    const paramsUser = new URLSearchParams();
    paramsUser.append("Identity", customerEmail);
    paramsUser.append("FriendlyName", customerFriendlyName);

    try {
        const resUser = await axios.post(`https://conversations.twilio.com/v1/Users/`, paramsUser, {
            auth: {
                username: process.env.ACCOUNT_SID,
                password: process.env.AUTH_TOKEN
            }
        });

        logInterimAction("User created ", resUser.data.sid);
    } catch (e) {
        if (e.response?.data?.code === 50201) {
            logInterimAction("User already exist -> ", customerEmail);
        } else {
            logInterimAction("Something went wrong during user creation:", e.response?.data?.message);
            throw e.response.data;
        }
    }

    try {
        const resUserConversations = await axios.get(`https://conversations.twilio.com/v1/ParticipantConversations?Identity=${customerEmail}`, {
            headers: {
                Authorization: `Basic ${Buffer.from(`${process.env.ACCOUNT_SID}:${process.env.AUTH_TOKEN}`, 'utf8').toString('base64')}`
            }
        });

        const openConversation = resUserConversations.data.conversations.find(conv => conv.conversation_state === "active")

        if (openConversation) {
            conversationSid = openConversation.conversation_sid;
            identity = customerEmail

            logInterimAction("Active conversation found", conversationSid);
            logInterimAction("Participant already in conversation ");
        } else {
            const params = new URLSearchParams();
            // params.append("AddressSid", ADDRESS_SID);
            params.append("FriendlyName", `Webchat - ${customerEmail}`);
            const [timestamp] = new Date().toJSON().replace(/-/g, "").replace("T", "").replace(/:/g, "").split(".");
            params.append("UniqueName", `${customerEmail}${timestamp}`);
            params.append(
                "PreEngagementData",
                JSON.stringify({
                    ...request.formData,
                    friendlyName: customerFriendlyName
                })
            );
            const newConversation = await axios.post(`https://conversations.twilio.com/v1/Conversations`, params, {
                auth: {
                    username: process.env.ACCOUNT_SID,
                    password: process.env.AUTH_TOKEN
                }
            });
            conversationSid = newConversation.data.sid

            logInterimAction("New conversation created ", conversationSid);

            try {
                const paramsWebhook = new URLSearchParams();
                // params.append("AddressSid", ADDRESS_SID);
                paramsWebhook.append("Configuration.Method", "POST");
                paramsWebhook.append("Configuration.Filters", "onMessageAdded");
                paramsWebhook.append("Configuration.FlowSid", FLOW_SID);
                paramsWebhook.append("Target", "studio");

                const resWebhook = await axios.post(`https://conversations.twilio.com/v1/Conversations/${conversationSid}/Webhooks`, paramsWebhook, {
                    auth: {
                        username: process.env.ACCOUNT_SID,
                        password: process.env.AUTH_TOKEN
                    }
                });

                logInterimAction("Conversation Webhook created ", resWebhook.data.sid);

            } catch (e) {
                logInterimAction("Something went wrong during participant creation:", e.response?.data?.message);
                throw e.response.data;
            }

            try {
                const resParticipant = await axios.post(`https://conversations.twilio.com/v1/Conversations/${conversationSid}/Participants`, paramsUser, {
                    auth: {
                        username: process.env.ACCOUNT_SID,
                        password: process.env.AUTH_TOKEN
                    }
                });

                logInterimAction("Participant created ", resParticipant.data.sid);
                ({ identity } = resParticipant.data);

            } catch (e) {
                logInterimAction("Something went wrong during participant creation:", e.response?.data?.message);
                throw e.response.data;
            }
        }
    } catch (e) {
        logInterimAction("Something went wrong during the orchestration:", e);
        throw e.response.data;
    }

    logInterimAction("Webchat Orchestrator successfully called");
    logInterimAction("Connecting webchat to Conversation ", conversationSid);

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
