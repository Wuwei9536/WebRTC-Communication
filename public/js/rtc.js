/* 数据通道 */
let dataChanel = null;
const url = window.location.href;
const roomHash = url.substring(url.lastIndexOf("/") + 1).toLowerCase();

// Element vars
const chatInput = document.querySelector(".compose input");
const remoteVideoVanilla = document.getElementById("remote-video");
const remoteVideo = document.getElementById("remote-video");
const captionText = document.getElementById("remote-video-text");
const localVideoText = document.getElementById("local-video-text");
const captionButtontext = document.getElementById("caption-button-text");
const entireChat = document.getElementById("entire-chat");
const chatZone = document.getElementById("chat-zone");

// Basic logging class wrapper
function logIt(message, error) {
  console.log(message);
}

const WebRTC = {
  connected: false,
  willInitiateCall: false,
  localICECandidates: [],
  socket: io(),
  remoteVideo: document.getElementById("remote-video"),
  localVideo: document.getElementById("local-video"),
  recognition: undefined,
  localStream: undefined,
  // Call to getUserMedia (provided by adapter.js for cross browser compatibility)
  // asking for access to both the video and audio streams. If the request is
  // accepted callback to the onMediaStream function, otherwise callback to the
  // noMediaStream function.
  requestMediaStream: function (event) {
    logIt("requestMediaStream");
    // rePositionLocalVideo();
    navigator.mediaDevices
      .getUserMedia({
        video: true,
        audio: true,
      })
      .then((stream) => {
        WebRTC.onMediaStream(stream);
        // localVideoText.text("Drag Me");
        // setTimeout(() => localVideoText.fadeOut(), 5000);
      })
      .catch((error) => {
        logIt(error);
        logIt(
          "Failed to get local webcam video, check webcam privacy settings"
        );
        // Keep trying to get user media
        setTimeout(WebRTC.requestMediaStream, 1000);
      });
  },

  // Called when a video stream is added to WebRTC
  onMediaStream: function (stream) {
    logIt("onMediaStream");
    WebRTC.localStream = stream;
    // Add the stream as video's srcObject.
    // Now that we have webcam video sorted, prompt user to share URL
    WebRTC.localVideo.srcObject = stream;
    // Now we're ready to join the chat room.
    WebRTC.socket.emit("join", roomHash);
    // Add listeners to the websocket
    // WebRTC.socket.on("full", chatRoomFull);
    WebRTC.socket.on("offer", WebRTC.onOffer);
    WebRTC.socket.on("ready", WebRTC.readyToCall);
    WebRTC.socket.on(
      "willInitiateCall",
      () => (WebRTC.willInitiateCall = true)
    );
  },

  // When we are ready to call, enable the Call button.
  readyToCall: function (event) {
    logIt("readyToCall");
    // First to join call will most likely initiate call
    if (WebRTC.willInitiateCall) {
      logIt("Initiating call");
      WebRTC.startCall();
    }
  },

  // Set up a callback to run when we have the ephemeral token to use Twilio's TURN server.
  startCall: function (event) {
    logIt("startCall >>> Sending token request...");
    WebRTC.socket.on("iceServers", WebRTC.onIceServers(WebRTC.createOffer));
    WebRTC.socket.emit("iceServers", roomHash);
  },

  // When we receive the ephemeral token back from the server.
  onIceServers: function (callback) {
    logIt("onIceServers");
    return function (token) {
      logIt("<<< Received token");
      // Set up a new RTCPeerConnection using the token's iceServers.
      WebRTC.peerConnection = new RTCPeerConnection({
        iceServers: token.iceServers,
      });
      // Add the local video stream to the peerConnection.
      WebRTC.localStream.getTracks().forEach(function (track) {
        WebRTC.peerConnection.addTrack(track, WebRTC.localStream);
      });
      // Add general purpose data channel to peer connection,
      // used for text chats, captions, and toggling sending captions
      dataChanel = WebRTC.peerConnection.createDataChannel("chat", {
        negotiated: true,
        // both peers must have same id
        id: 0,
      });
      // Called when dataChannel is successfully opened
      dataChanel.onopen = function (event) {
        logIt("dataChannel opened");
      };
      // Handle different dataChannel types
      dataChanel.onmessage = function (event) {
        const receivedData = event.data;
        // First 4 chars represent data type
        const dataType = receivedData.substring(0, 4);
        const cleanedMessage = receivedData.slice(4);
        if (dataType === "mes:") {
          handleRecieveMessage(cleanedMessage);
        } else if (dataType === "cap:") {
          // recieveCaptions(cleanedMessage);
        } else if (dataType === "tog:") {
          // toggleSendCaptions();
        }
      };

      // Set up callbacks for the connection generating iceCandidates or
      // receiving the remote media stream.
      WebRTC.peerConnection.onicecandidate = WebRTC.onIceCandidate;
      WebRTC.peerConnection.ontrack = WebRTC.onTrack;
      // Set up listeners on the socket
      WebRTC.socket.on("candidate", WebRTC.onCandidate);
      WebRTC.socket.on("answer", WebRTC.onAnswer);

      // Called when there is a change in connection state
      WebRTC.peerConnection.oniceconnectionstatechange = function (event) {
        switch (WebRTC.peerConnection.iceConnectionState) {
          case "connected":
            logIt("connected");
            // Once connected we no longer have a need for the signaling server, so disconnect
            WebRTC.socket.disconnect();
            break;
          case "disconnected":
            logIt("disconnected");
          case "failed":
            logIt("failed");
            // WebRTC.socket.connect
            // WebRTC.createOffer();
            // Refresh page if connection has failed
            location.reload();
            break;
          case "closed":
            logIt("closed");
            break;
        }
      };
      callback();
    };
  },

  // When the peerConnection generates an ice candidate, send it over the socket to the peer.
  onIceCandidate: function (event) {
    logIt("onIceCandidate");
    if (event.candidate) {
      logIt(
        `<<< Received local ICE candidate from STUN/TURN server (${event.candidate.address})`
      );
      if (WebRTC.connected) {
        logIt(`>>> Sending local ICE candidate (${event.candidate.address})`);
        WebRTC.socket.emit(
          "candidate",
          JSON.stringify(event.candidate),
          roomHash
        );
      } else {
        // If we are not 'connected' to the other peer, we are buffering the local ICE candidates.
        // This most likely is happening on the "caller" side.
        // The peer may not have created the RTCPeerConnection yet, so we are waiting for the 'answer'
        // to arrive. This will signal that the peer is ready to receive signaling.
        WebRTC.localICECandidates.push(event.candidate);
      }
    }
  },

  // When receiving a candidate over the socket, turn it back into a real
  // RTCIceCandidate and add it to the peerConnection.
  onCandidate: function (candidate) {
    // Update caption text
    rtcCandidate = new RTCIceCandidate(JSON.parse(candidate));
    logIt(
      `onCandidate <<< Received remote ICE candidate (${rtcCandidate.address} - ${rtcCandidate.relatedAddress})`
    );
    WebRTC.peerConnection.addIceCandidate(rtcCandidate);
  },

  // Create an offer that contains the media capabilities of the browser.
  createOffer: function () {
    logIt("createOffer >>> Creating offer...");
    WebRTC.peerConnection.createOffer(
      function (offer) {
        // If the offer is created successfully, set it as the local description
        // and send it over the socket connection to initiate the peerConnection
        // on the other side.
        WebRTC.peerConnection.setLocalDescription(offer);
        WebRTC.socket.emit("offer", JSON.stringify(offer), roomHash);
      },
      function (err) {
        logIt("failed offer creation");
        logIt(err, true);
      }
    );
  },

  // Create an answer with the media capabilities that both browsers share.
  // This function is called with the offer from the originating browser, which
  // needs to be parsed into an RTCSessionDescription and added as the remote
  // description to the peerConnection object. Then the answer is created in the
  // same manner as the offer and sent over the socket.
  createAnswer: function (offer) {
    logIt("createAnswer");
    return function () {
      logIt(">>> Creating answer...");
      rtcOffer = new RTCSessionDescription(JSON.parse(offer));
      WebRTC.peerConnection.setRemoteDescription(rtcOffer);
      WebRTC.peerConnection.createAnswer(
        function (answer) {
          WebRTC.peerConnection.setLocalDescription(answer);
          WebRTC.socket.emit("answer", JSON.stringify(answer), roomHash);
        },
        function (err) {
          logIt("Failed answer creation.");
          logIt(err, true);
        }
      );
    };
  },

  // When a browser receives an offer, set up a callback to be run when the
  // ephemeral token is returned from Twilio.
  onOffer: function (offer) {
    logIt("onOffer <<< Received offer");
    WebRTC.socket.on(
      "iceServers",
      WebRTC.onIceServers(WebRTC.createAnswer(offer))
    );
    WebRTC.socket.emit("iceServers", roomHash);
  },

  // When an answer is received, add it to the peerConnection as the remote description.
  onAnswer: function (answer) {
    logIt("onAnswer <<< Received answer");
    var rtcAnswer = new RTCSessionDescription(JSON.parse(answer));
    // Set remote description of RTCSession
    WebRTC.peerConnection.setRemoteDescription(rtcAnswer);
    // The caller now knows that the callee is ready to accept new ICE candidates, so sending the buffer over
    WebRTC.localICECandidates.forEach((candidate) => {
      logIt(`>>> Sending local ICE candidate (${candidate.address})`);
      // Send ice candidate over websocket
      WebRTC.socket.emit("candidate", JSON.stringify(candidate), roomHash);
    });
    // Reset the buffer of local ICE candidates. This is not really needed, but it's good practice
    WebRTC.localICECandidates = [];
  },

  // Called when a stream is added to the peer connection
  onTrack: function (event) {
    logIt("onTrack <<< Received new stream from remote. Adding it...");
    // Update remote video source
    WebRTC.remoteVideo.srcObject = event.streams[0];
    document.getElementById("loader-ball").style.display = "none";
    // Close the initial share url snackbar
    // Remove the loading gif from video
    WebRTC.remoteVideo.style.background = "none";
    // Update connection status
    WebRTC.connected = true;
    // Hide caption status text
    // Reposition local video after a second, as there is often a delay
    // between adding a stream and the height of the video div changing
    // setTimeout(() => rePositionLocalVideo(), 500);
    // var timesRun = 0;
    // var interval = setInterval(function () {
    //   timesRun += 1;
    //   if (timesRun === 10) {
    //     clearInterval(interval);
    //   }
    //   rePositionLocalVideo();
    // }, 300);
  },
};

// Text Chat
// Add text message to chat screen on page
function addMessageToScreen(msg, isOwnMessage) {
  const msgContent = document.createElement("div");
  msgContent.setAttribute("class", "message");
  msgContent.textContent = msg;
  const msgBloc = document.createElement("div");
  msgBloc.setAttribute("class", "message-bloc");
  msgBloc.appendChild(msgContent);
  const msgItem = document.createElement("div");
  msgItem.setAttribute(
    "class",
    "message-item customer cssanimation fadeInBottom"
  );
  msgItem.appendChild(msgBloc);
  if (isOwnMessage) {
    document.getElementById("chat-messages").appendChild(msgItem);
  } else {
    document.getElementById("chat-messages").appendChild(msgItem);
  }
}

// Show and hide chat
function toggleChat() {
  var chatIcon = document.getElementById("chat-icon");
  var chatText = document.getElementById("chat-text");
  if (entireChat.is(":visible")) {
    entireChat.fadeOut();
    // Update show chat buttton
    chatText.textContent("Show Chat");
    chatIcon.classList.remove("fa-comment-slash");
    chatIcon.classList.add("fa-comment");
  } else {
    entireChat.fadeIn();
    // Update show chat buttton
    chatText.textContent("Hide Chat");
    chatIcon.classList.remove("fa-comment");
    chatIcon.classList.add("fa-comment-slash");
  }
}

// Listen for enter press on chat input
chatInput.addEventListener("keypress", function (event) {
  if (event.keyCode === 13) {
    // Prevent page refresh on enter
    event.preventDefault();
    var msg = chatInput.value;
    // Prevent cross site scripting
    msg = msg.replace(/</g, "&lt;").replace(/>/g, "&gt;");
    // Make links clickable
    msg = msg.autoLink();
    // Send message over data channel
    dataChanel.send("mes:" + msg);
    // Add message to screen
    addMessageToScreen(msg, true);
    // Auto scroll chat down
    chatZone.scrollTop = chatZone.scrollHeight;
    // Clear chat input
    chatInput.value = "";
  }
});

// Called when a message is recieved over the dataChannel
function handleRecieveMessage(msg) {
  // Add message to screen
  addMessageToScreen(msg, false);
  // Auto scroll chat down
  chatZone.scrollTop = chatZone.scrollHeight;
  // Show chat if hidden
  if (entireChat.is(":hidden")) {
    toggleChat();
  }
}

WebRTC.requestMediaStream();
