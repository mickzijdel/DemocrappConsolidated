var currentPage;
var cast;
var sessionState = "new";
var sessionToken;
var meetingName;
var voters;
var API_HOST = location.host;
var API_WS_PROTOCOL = location.protocol == "https:" ? "wss://" : "ws://";
var annId = 0;
var visibleCards = 0;
var unfilledBallots = 0;
var KIOSK_MODE;
var _meetingId;

// Flag to ensure there is only one revote alert.
var shownRevoteAlert = false;

// Routing
var routes = {
  "_description": "This file is used to define routing of the application.",
  "/": "landing",
  "#/": "landing",
  "": "landing",
  "#/auth": "auth",
  "#/stv": "stv",
  "#/blank": "blank",
  "#/credits": "credits",
  "#/loading": "loading"
};

function translateHash(hash) {
  if (hash === "") { return translateHash("/"); }
  if (routes[hash] != null) { return routes[hash]; }
  return "404";
}

function replacePage(id) {
  $.ajax({
    method: 'GET',
    url: '/pages/' + id + '.html',
    success: function(data) {
      $('#page').html(data);
      currentPage = id;
      $('#loader').fadeOut(() => {$('#page').fadeIn()});
    },
    error: function(textStatus) {
      alert("AJAX failure: " + textStatus + ". Please try again.");
      $('#page').html(data);
    },
    dataType: 'html'
  })
}

function addBallotCard(html) {
  if (visibleCards == 0) {
    $('#message-connected').fadeOut();
  }
  $(html).hide().appendTo("#stream").fadeIn();
  visibleCards++;
}

function replaceStream(html) {
  var s = $('#stream');
  s.fadeOut(() => {
    s.html(html);
    s.fadeIn();
  });
}

function dismissElement(id) {
  $('#' + id).fadeOut(() => $('#' + id).remove());
  console.log("[STREAM] Dismissed element " + id);
  visibleCards--;
  if (visibleCards == 0) {
    if (KIOSK_MODE) {
      userEndSession();
    }
    $('#message-connected').fadeIn();
  }
}

// auth page scripts

function loadAuth() {
  $('#page').fadeOut(() => $('#loader').fadeOut(() => {
    $.ajax({
      url: location.protocol + '//' + API_HOST + '/api/list',
      success: function(data) {
        if (data.meetings.length == 0) {
          replacePage('nomeetings');
          return;
        }
        $.get("/templates/auth.mustache", function(template) {
          $('#page').html(Mustache.render(template, data));
          $('#loader').fadeOut(() => $('#page').fadeIn());
          $('#authForm').submit(submitTokenForm);
        });
      },
      error: function(textStatus) {
        alert('There has been an error communicating with the DemocrApp server. Error: ' + textStatus);
      }
    })
  }))
}

function loadKioskLanding() {
  $('#page').fadeOut(() => $('#loader').fadeOut(() => {
    $.ajax({
      url: location.protocol + '//' + API_HOST + '/api/list',
      success: function(data) {
        if (data.meetings.length == 0) {
          replacePage('nomeetings');
          return;
        }
        var meeting = data.meetings.find(m => m.id == _meetingId)
        if (meeting){
          $.get("/templates/kiosk-landing.mustache", function(template) {
            $('#page').html(Mustache.render(template, {'meeting_name': meeting.name, 'meeting_id': _meetingId}));
            $('#loader').fadeOut(() => $('#page').fadeIn());
            $('#authToken').focus();
            $('#authForm').submit(submitTokenForm);
          });
        } else {
          replacePage('400');
          alert('Invalid meeting ID. Contact event organiser.');
        }
      },
      error: function(textStatus) {
        alert('There has been an error communicating with the DemocrApp server. Error: ' + textStatus);
      }
    })
  }))
}

function submitTokenForm(event) {
  event.preventDefault();
  checkToken($('#authToken').val(), $('#authMeetings').val());
}

function checkToken(authToken, meetingId) {
  var urlmatch = authToken.match(/.+\?t=(\d{8}).+/);
  if (urlmatch) { authToken = urlmatch[1]; }
  $.ajax({
    url: location.protocol + '//' + API_HOST + '/api/' + meetingId + '/checktoken',
    method: 'POST',
    data: {
      "token": authToken
    },
    success: function(data) {
      console.log(data);
      if (data.success == true) {
        tokenValid(data);
      } else {
        alert("That voter token is invalid. Please try again.");
      }
    },
    error: function() {
      alert("There was an issue communicating with the DemocrApp API. Please try again.");
    }
  })
}

function tokenValid(data) {
  Cookies.set("session_token", data.session_token, { expires: 1 });
  sessionToken = data.session_token;
  openSocket();
}

function ballotRecieved(msg) {
  // If any of the ballots have already been submitted, and the revote-alert has not already been shown, show it.
  if (msg.existing_ballots.length > 0 && shownRevoteAlert == false) {
    shownRevoteAlert = true;
    $.get("/templates/revote-alert.mustache", function(template) {
      $(Mustache.render(template, {ballot_name: msg.title})).appendTo('#alerts');
    });
  }

  switch (msg.method){
    case "STV":
      console.log("[BALLOT] New using STV");
      voters.forEach(voter => {
        var v = {
          ballot_id: msg.ballot_id,
          title: msg.title,
          desc: msg.desc,
          options: msg.options
        }

        // I do not understand why this check is necessary, but I am reluctant to delete it. It is true for both the primary voter and any proxies.
        if ((voter.type != "proxy") || msg.proxies){
          v.proxy = (voter.type == "proxy");
          v.voter_id = voter.token;
          v.already_voted = msg.existing_ballots.some(el => el.option__vote === msg.ballot_id && el.token_id===voter.token)
    
          $.get("/templates/stv-card.mustache", function(template) {
            addBallotCard(Mustache.render(template, v));
          });
        }
      });
      break;
    case "YNA":
      console.log("[BALLOT] New using Y/N/A");
      voters.forEach(voter => {
        // I do not understand why this check is necessary, but I am reluctant to delete it. It is true for both the primary voter and any proxies.
        if ((voter.type != "proxy") || msg.proxies){
          var v = {
            ballot_id: msg.ballot_id,
            title: msg.title,
            desc: msg.desc,
            yes_id: "foo",
            no_id: "bar",
            abs_id: "zip"
          }
          msg.options.forEach(option => {
            switch (option.name){
              case "yes":
                v.yes_id = option.id;
                break;
              case "no":
                v.no_id = option.id;
                break;
              case "abs":
                v.abs_id = option.id;
                break;
              default:
                console.log("[BALLOT] Unexpected YNA option name " + option.name + " - ignoring");
                break;
          }
          })
          if (v.yes_id == undefined || v.no_id == undefined || v.abs_id == undefined) {
            console.error("[BALLOT] Incomplete YNA option ID set. Unable to render.");
            return;
          }
          v.proxy = (voter.type == "proxy");
          v.voter_id = voter.token;

          v.already_voted = msg.existing_ballots.some(el => el.option__vote === msg.ballot_id && el.token_id===voter.token)

          $.get("/templates/yna-card.mustache", function(template) {
            addBallotCard(Mustache.render(template, v));
          });
        }
      });
      break;
    default:
      console.error("[BALLOT] Unsupported method: \"" + msg.method + "\"");
      break;
  }
}

function submitSTVBallot(cardId) {
  var form = $('#' + cardId);
  var options = form.serializeArray();
  options.sort((a, b) => { return a.value - b.value; });
  var currentpref = 1;
  var out = {}
  options.forEach(option => {
    if (!option.value) { /* ignore */ }
    else if (option.value % 1 != 0) { currentpref = -1; return;}
    else if (option.value == currentpref) { currentpref++; out[option.name] = option.value; }
    else { currentpref = -1; return; }
  })
  if (currentpref == -1) {
    Sentry.captureMessage('Options selection problem', {options_list: options});
    alert("Please double check your preference entries, use consecutive whole numbers");
    return;
  }
  $('#' + cardId + ' .card-footer button').fadeOut();
  $('#' + cardId + ' .list-group').fadeOut(() => {
    $('#' + cardId + " .loader").fadeIn(() => {
      var message = {
        type: "ballot_form",
        ballot_id: form.attr('data-ballot'),
        session_token: sessionToken,
        votes: {}
        }
      message.votes[form.attr('data-voter')] = out;
      console.log("[BALLOT] Submitting ballot for " + cardId);
      console.log(message);
      cast.send(JSON.stringify(message));
    })
  });
}

function ynaButtonClick(id) {
  console.log("button clicked");
  var button = $('#' + id);
  if (button.hasClass('active')){
    // Already clicked once, we need to submit
    ynaSubmit(button.parent().attr('data-ballotid'), button.parent().attr('data-voterid'), button.attr('data-optid'));
    return;
  }
  button.siblings().removeClass('active');
  button.addClass('active');
}

function ynaSubmit(ballot_id, voter_id, opt_id) {
  console.log('ynaSubmit Fired');
  $('#b-' + voter_id + ballot_id + ' .card-footer').children().fadeOut();
  $('#b-' + voter_id + ballot_id + ' .active-body').fadeOut(() => {
    $('#b-' + voter_id + ballot_id + " .loader").fadeIn(() => {
      var message = {
        type: "ballot_form",
        ballot_id: ballot_id,
        session_token: sessionToken,
        votes: {}
        }
      message.votes[voter_id] = {};
      message.votes[voter_id][opt_id] = 1;
      console.log("[BALLOT] Submitting ballot for " + voter_id + ballot_id);
      console.log(message);
      cast.send(JSON.stringify(message));
    });
  });
}

function ballotReceipt(msg) {
  if (msg.result == "failure") {
    visibleCards -= $('#stream [data-ballot=' + msg.ballot_id +']').length;
    $('#stream [data-ballot=' + msg.ballot_id +']').fadeOut();
    $.get("/templates/ballot-failed.mustache", function(template) {
      $('#stream').prepend(Mustache.render(template, { id: msg.ballot_id+'_err', reason: msg.reason })).fadeIn();
      visibleCards++;
    });
    return;
  }
  msg.voter_token.forEach(voter => {
    var card_id = 'b-' + voter + msg.ballot_id;
    console.log("[BALLOT] API acknowledged receipt of vote from card id " + card_id + ".");
    $('#' + card_id + ' .loader').fadeOut(() => {
      $('#' + card_id + ' .success').fadeIn();
    })
    unfilledBallots--;
    if ( unfilledBallots == 0 && KIOSK_MODE){
      setTimeout(userEndSession, 1000);
    }
  })
}

function ballotClosed(msg) {
  var ballotcards = $('#stream [data-ballot=' + msg.ballot_id +'] .card-title')
  if (ballotcards.length) {
    var v = {
      ballot_name: $('#stream [data-ballot=' + msg.ballot_id +'] .card-title').first().html(),
      reason: msg.reason,
      id: "a-" + (annId++)
    }
    $.get("/templates/ballot-closed-card.mustache", function(template) {
      addBallotCard(Mustache.render(template, v));
    });
    $('#stream [data-ballot=\'' + msg.ballot_id + '\']').fadeOut(() => {
      $(this).remove();
      visibleCards--;
    });
  }
}

// Websocket things
function castRecieved(msg) {
  console.log("[CAST] Recieved " + msg.type);
  console.log(msg);
  switch (msg.type) {
    case "auth_response":
      if (msg.result == "success"){
        console.log("[CAST] Authentication success.");
        $('#logoutButton').show();
        meetingName = msg.meeting_name;
        voters = msg.voters;
        sessionState = "connected";
        $.get("/templates/stream.mustache", function(template) {
          $('#page').html(Mustache.render(template, { meeting_name: meetingName }));
        });
      } else {
        console.log("[CAST] Authentication failed.");
        sessionState = "terminated";
        closeSocket();
        $.get("/templates/auth-failed.mustache", function(template) {
          $('#page').html(Mustache.render(template, { reason: msg.reason }));
        });
        Cookies.remove("session_token");
      }
      break;
    case "ballot":
      ballotRecieved(msg);
      break;
    case "ballot_receipt":
      ballotReceipt(msg);
      break;
    case "ballot_closed":
      ballotClosed(msg);
      break;
    case "terminate_session":
      terminateSession(msg);
      break;
    case "announcement":
      var id = "a-" + (annId++);
      $.get("/templates/message-card.mustache", function(template) {
        $('#stream').hide().prepend(Mustache.render(template, { id: id, message: msg.message })).fadeIn();
        if (visibleCards == 0) {
          $('#message-connected').fadeOut();
        }
        visibleCards++;
      });
      break;
    default:
      alert("There has been a communications error.");
      break;
  }
}

function openSocket() {
  cast = new WebSocket(API_WS_PROTOCOL + API_HOST + "/cast");
  castState = "connecting";
  replacePage('loading');
  var hs = {
    "type": "auth_request",
    "session_token": Cookies.get("session_token")
  }
  console.log(hs);
  cast.onopen = function() {
    cast.send(JSON.stringify(hs));
  }
  cast.onmessage = function(msg) { castRecieved(JSON.parse(msg.data)); } ;
  cast.onerror = (e) => { noSocket(e) };
  cast.onclose = (e) => { socketFailed(e) };
}

function noSocket(e) {
  sessionState = "failed";
  console.log("[CAST] Unable to create Websocket.");
  console.log(e);
  $.get("/templates/conn-failed-card.mustache", function(template) {
    var v = {
      code: "WS_INIT_FAIL",
      reason: "Unable to create Websocket."
    };
    $('#page').html(Mustache.render(template, v));
  });
}

function socketFailed(e) {
  if (sessionState == "terminated") { return; }
  sessionState = "failed";
  console.log("[CAST] Websocket failed.")
  $.get("/templates/conn-failed-card.mustache", function(template) {
    var v = {
      code: e.code,
      reason: e.reason
    };
    replaceStream(Mustache.render(template, v));
  });
}

function closeSocket() {
  if (cast != undefined) {
    if (cast.readyState == 1) {
      console.log("[CAST] Closing websocket");
      cast.close();
    }
  }
}

window.onbeforeunload = closeSocket;

function terminateSession(msg) {
  $('logoutButton').hide();
  sessionState = "terminated";
  console.log("[CAST] Session terminated by server.");
  $.get("/templates/terminated-card.mustache", function(template) {
    replaceStream(Mustache.render(template, {reason: msg.reason} ));
  });
  cast.close();
  Cookies.remove("session_token");
}

function userEndSession() {
  $('logoutButton').hide();
  console.log("[SESSION] User terminated session.");
  cast.close();
  Cookies.remove("session_token");
  if (KIOSK_MODE){
    location.replace(location.protocol + "//" + location.host + "/?k=true&m=" + _meetingId);
  } else {
    location.reload();
  }
}

$.urlParam = function(name){
  var results = new RegExp('[\?&]' + name + '=([^&#]*)').exec(window.location.href);
  if (results==null){
    return null;
  }
  else{
    return decodeURI(results[1]) || 0;
  }
}

// Page initialisation
function init() {
  KIOSK_MODE = ($.urlParam('k') == "true");
  if (KIOSK_MODE) {
    Cookies.remove("session_token");
    if (!$.urlParam('m')) { replacePage('400'); }
    _meetingId = $.urlParam('m');
    loadKioskLanding();
    return;
  }
  if (Cookies.get("session_token") != undefined) {
    console.log("[INIT] Found existing session token.");
    sessionToken = Cookies.get("session_token");
    openSocket();
  } else {
    replacePage('landing');
    if ($.urlParam('t')) {
      checkToken($.urlParam('t'), $.urlParam('m'));
    }
  }
}

$(document).ready(function() {
  console.log("[INIT] Checking for WebSocket support");
  if (window.WebSocket){
    console.log("[INIT] WebSocket support found");
    init();
  }
  else {
    console.error("[INIT] WebSocket support not found. Unable to launch app.");
    replacePage('notsupported');
  }
  //replacePage(translateHash(window.location.hash));
});
