const fetch = require('node-fetch');

const moment = require('moment');

const gpio = require('onoff').Gpio;
const connectedGreenLED = new gpio(16, 'out');
const soilMoisture = new gpio(20, 'in');

const relays = [
    new gpio(17, 'out'),
    new gpio(27, 'out'),
    new gpio(20, 'out'),
    new gpio(21, 'out'),
];

var colors = require('colors');

// var v4l2camera = require("v4l2camera");

var raspberryPiId = "robo_001";
var raspberryPiGrowId = "600880876b9f855a3eb2b5bc";
var raspberryPiGrowConfigId = "5eea4b705f99f8370cc9e126";

var tempSensor = require("node-dht-sensor");

const Tsl2561 = require("ada-tsl2561");
const lumenSensor = new Tsl2561();

var WebSocket = require('ws');

var dataHandler;
var noSleepHandler;
var relayHandler;

var currentGrow;
var currentGrowConfig;

var token;

var lastDataObject;

AttemptToAuthenticate();

function AttemptToAuthenticate() {
    const requestOptions = {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
            "email": "sdenomme15@gmail.com",
            "password": "pasteFlux1992"
        })
    };

    fetch('https://api.robogrow.io/authenticate', requestOptions)
        .then(res => res.json())
        .then(json => {
            if (!json.errors) {
                token = json.token;

                InitializeWebSocket();
            } else {
                console.log("Error authenticating... Attempting to authenticate again in 5 seconds.");

                setTimeout(AttemptToAuthenticate, 5000);
            }
        })
        .catch(err => {
            console.log("Error authenticating... Attempting to authenticate again in 5 seconds.");

            setTimeout(AttemptToAuthenticate, 5000);
        });
}

var ws;
var relaysAreInitialized = false;

function InitializeWebSocket() {
    if (token) {
        ws = new WebSocket("wss://api.robogrow.io", {
            headers: {
                token: token
            },
            followRedirects: true
        }, {
            followRedirects: true
        });

        console.log("Initializing Websocket... " + ws.url);

        ws.on('open', function () {
            console.log('Connection successfully opened to server.');
            console.log('Turning on green connectivity LED.');
            connectedGreenLED.writeSync(1);
        });

        ws.on('error', function (error) {
            console.log(`WebSocket error: ${error}`)
        });

        ws.on('close', function close() {
            console.log('Connection broken to server... Attempting to re-open connection in 5 seconds.');
            console.log('Turning off green connectivity LED.');
            console.log('');
            connectedGreenLED.writeSync(0);

            setTimeout(AttemptToAuthenticate, 5000);

            console.log('Stopping data send handler.');
            clearInterval(dataHandler);
        });

        ws.on('message', function (data, flags) {
            if (data) {
                data = JSON.parse(data);

                // Is initialization?
                if (data.initialization) {
                    console.log(data.message);

                    console.log("Sending ID's to server, waiting for data send event.");
                    console.log('');

                    ws.send(JSON.stringify({
                        growId: raspberryPiGrowId,
                        configId: raspberryPiGrowConfigId,
                        scriptId: raspberryPiId,
                        identify: true
                    }));
                }

                if (data.send) {
                    console.log("Received trigger for send event... beginning data loop...");
                    console.log('');
                    currentGrow = data.grow;
                    currentGrowConfig = data.config;

                    // Only run this if needed
                    if (!relaysAreInitialized) {
                        ScheduleRelays();
                    } else {
                        console.log("Relays have already been initialized. :D");
                    }

                    let minutes = 10;
                    let interval = minutes * 60 * 1000;
                    let noSleepInterval = 59 * 1000; // 59 seconds (socket timeout is 60 seconds)
                    let conditionalSensorReadInterval = 1 * 1000; // 1 second (this helps keep conditional relays in check)

                    console.log("Setting data report interval " + minutes + " minutes");

                    // Set sensor data loop
                    noSleepHandler = setInterval(SendNoSleepPacket, noSleepInterval); // 59 seconds

                    dataHandler = setInterval(function () {
                        AttemptToGetDataFromSensors(true).then(r => {/*do nothing*/
                        });
                    }, interval); // 10 minute(s)

                    dataHandler = setInterval(function () {
                        AttemptToGetDataFromSensors(false).then(r => {/*do nothing*/
                        });
                    }, conditionalSensorReadInterval); // 1 second
                }

                // Is relay manual override?
                if (data.relayOverride) {
                    // Collect GPIO pin and attempt to turn it on / off
                }

                if (data.updateConfig) {
                    // Refresh config data and re-initialize
                    console.log("Update Config Event Received.");

                    currentGrowConfig = data.config;
                    ScheduleRelays();
                }
            }
        });
    } else {
        // NO TOKEN
        console.log("NO TOKEN??");
    }
}

async function SendNoSleepPacket() {
    ws.send(JSON.stringify({
        message: "No Sleep!"
    }));
}

async function AttemptToGetDataFromSensors(sendToServer) {
    // TODO: Determine if any relays need to be toggled.
    console.log("AttemptToGetDataFromSensors(" + sendToServer + ")")
    tempSensor.read(22, 4)
        .then((err, temperature, humidity) => {
            if (!err) {
                console.log("...");
                var cTemp = temperature;
                var fTemp = (cTemp * 9 / 5 + 32).toFixed(2);

                if (fTemp && fTemp != 0.0) {
                    tempGreenLED.writeSync(1);
                }

                humidity = (humidity) ? humidity.toFixed(2) : undefined;

                if (sendToServer) {
                    console.log("Temp: " + fTemp + " Humidity: " + humidity);
                }

                // navigator.mediaDevices.getUserMedia({
                //     video: {
                //         width: 426,
                //         height: 240
                //     }
                // }).then((stream) => video.srcObject = stream);

                var infrared;
                var lux;
                getLumen().then(function (luxObj) {
                    infrared = (luxObj && luxObj.infrared) ? luxObj.infrared.toFixed(2) : undefined;
                    lux = (luxObj && luxObj.lux) ? luxObj.lux.toFixed(2) : undefined;

                    if (sendToServer) {
                        console.log("Infrared: " + infrared + " Lux: " + lux);
                    }

                    var dataObject = {
                        growId: raspberryPiGrowId,
                        temp: fTemp,
                        humidity: humidity,
                        infrared: infrared,
                        lux: lux,
                        config: currentGrowConfig,
                        createGrowEvent: true
                    };

                    if (!sendToServer) {
                        // Compare last sent data object with new data object
                        CheckConditionalRelayStatus(dataObject);
                    } else {
                        console.log("Sending sensor data now.");
                        console.log("");

                        ws.send(JSON.stringify(dataObject));
                        lastDataObject = dataObject;
                    }
                    // }
                }).catch((e) => {
                    // EREMOTEIO Cannot read / write TSL2561

                    if (sendToServer) {
                        console.log("Could not read infrared / lumen sensor.".red);

                        console.log(" ");
                    }

                    var dataObject = {
                        growId: raspberryPiGrowId,
                        temp: fTemp,
                        humidity: humidity,
                        infrared: infrared,
                        lux: lux,
                        config: currentGrowConfig,
                        createGrowEvent: true
                    };

                    if (!sendToServer) {
                        console.log("Attempting to read Soil Moisture: ");
                        console.log(soilMoisture.readSync());

                        // Compare last sent data object with new data object
                        CheckConditionalRelayStatus(dataObject);
                    } else {
                        console.log("Sending sensor data now.");
                        console.log("");

                        ws.send(JSON.stringify(dataObject));
                        lastDataObject = dataObject;
                    }
                });
            } else {
                console.log("ERR");
                console.log(err);
            }
        }).catch((e) => {
            console.log(e);
    });
}

// TODO: This function needs to be made much more generic, lots of duplicated code
async function CheckConditionalRelayStatus(dataObject) {
    if (dataObject) {
        // Loop through configured relays
        currentGrowConfig.relaySchedules.forEach((schedule) => {
            // If the relay is a 'conditional'
            if (schedule.type == 0) {
                schedule.conditions.forEach((condition) => {
                    // Parse the conditional
                    if (condition.type == 0) { // Temp
                        if (dataObject.temp < condition.minValue) {
                            // if minValue, we're looking for something to get too 'low'
                            LookForRelayIdAndSetDesiredStatus(condition.relayIndex, condition.underMinStatus, "Temperature Too LOW. Setting relayIndex ")
                        } else if (dataObject.temp > condition.maxValue) {
                            // if maxValue, we're looking for something to get too 'high'
                            LookForRelayIdAndSetDesiredStatus(condition.relayIndex, condition.overMaxStatus, "Temperature Too HIGH. Setting relayIndex ")
                        }
                    } else if (condition.type == 1) { // Humidity
                        if (dataObject.humidity < condition.minValue) {
                            // if minValue, we're looking for something to get too 'low'
                            LookForRelayIdAndSetDesiredStatus(condition.relayIndex, condition.underMinStatus, "Humidity Too LOW. Setting relayIndex ")
                        } else if (dataObject.humidity > condition.maxValue) {
                            // if maxValue, we're looking for something to get too 'high'
                            LookForRelayIdAndSetDesiredStatus(condition.relayIndex, condition.overMaxStatus, "Humidity Too HIGH. Setting relayIndex ")
                        }
                    }
                })
            }
        })
    }
}

async function LookForRelayIdAndSetDesiredStatus(relayId, desiredStatus, preString) {
    relays.forEach((relay, index) => {
        // Find the target relay
        if (index == relayId) {
            if (relay.readSync() !== desiredStatus) {
                console.log(preString + relayId + " to status " + desiredStatus);
                relay.writeSync(desiredStatus);
            }
        }
    })
}

async function handleSensorDataSend() {

}


async function getSoilMoisture() {

}

async function getLumen() {
    await lumenSensor.init(1);

    let enabled = await lumenSensor.isEnabled();

    if (!enabled)
        await lumenSensor.enable();

    let broadband = await lumenSensor.getBroadband();
    let infrared = await lumenSensor.getInfrared();
    let lux = await lumenSensor.getLux();

    return {
        broadband: broadband,
        infrared: infrared,
        lux: lux
    };
}

var nodeSchedule = require('node-schedule');
var AsciiTable = require('ascii-table');

function pad(n) {
    return (n < 10) ? ("0" + n) : n;
}

let relayJobs = [];

// Check if a relay needs to be turned on or off
function ScheduleRelays() {
    if (currentGrowConfig && currentGrowConfig.relaySchedules) {
        if (relayJobs.length > 0) {
            console.log("Clearing existing jobs...");
            relayJobs.forEach((job) => {
                console.log("Clearing job: " + JSON.stringify(job));

                job.cancel();
            });

            relayJobs = [];
        }

        // Relays
        var relaySchedules = currentGrowConfig.relaySchedules;

        var table = new AsciiTable('Relay Events');

        // For each schedule
        relaySchedules.forEach((schedule, index) => {
            if (schedule.type == 1) {
                let currentEvent;

                // Get current event, and next event by looking at current time
                // Check every event, if current time is past
                schedule.events.forEach((event, eIndex) => {
                    let isToday = (eIndex + 1 < schedule.events.length);
                    var nextEvent = schedule.events[isToday ? eIndex + 1 : 0];

                    var curDate = moment(event.triggerTime, 'HH:mm:ss');
                    var nextDate = moment(nextEvent.triggerTime, 'HH:mm:ss');

                    console.log("events: " + schedule.events.length);

                    if (!isToday) {
                        if (schedule.events.length > 1) {
                            // Event takes place tomorrrow add 24 hours to nextEvent (for 'current event')
                            curDate = curDate.subtract(24, 'hours');
                        } else {
                            // Event takes place tomorrrow add 24 hours to nextEvent (for 'current event')
                            nextDate = nextDate.add(24, 'hours');
                        }
                    }

                    console.log("is "
                        + moment().format('YYYY-MM-DD HH:mm:ss')
                        + " between "
                        + curDate.format('YYYY-MM-DD HH:mm:ss')
                        + " (currdate) compared to "
                        + nextDate.format('YYYY-MM-DD HH:mm:ss')
                        + " " + moment().isBetween(curDate, nextDate));

                    if (moment().isBetween(curDate, nextDate)) {
                        schedule.currentEvent = event;
                    }

                    if (event.triggerTime && nextEvent.triggerTime) {
                        var triggerTime = event.triggerTime.split(":");

                        var triggerTimeHours = parseInt(triggerTime[0]);
                        var triggerTimeMinutes = parseInt(triggerTime[1]);
                        var triggerTimeSeconds = parseInt(triggerTime[2]);

                        table.addRow((pad(triggerTimeHours) + ":" + pad(triggerTimeMinutes) + ':' + pad(triggerTimeSeconds)), event.Description);

                        console.log("Now: " + new Date());
                        console.log("TT: " + pad(triggerTimeHours) + ":" + pad(triggerTimeMinutes) + ':' + pad(triggerTimeSeconds));

                        var j = nodeSchedule.scheduleJob({
                            hour: triggerTimeHours,
                            minute: triggerTimeMinutes,
                            second: triggerTimeSeconds
                        }, function () {
                            console.log(new Date() + ' FIRE JOB: ' + event.status + ' -- ' + event.Description);
                            relays[index].writeSync(event.status);
                            console.log('Relay Status: ' + relays[index].readSync());
                        });

                        relayJobs.push(j);
                    }
                });

                if (schedule.currentEvent) {
                    // Associate relay GPIO with schedule id
                    let associatedRelay = relays[index];
                    DetermineRequiredRelayStatus(associatedRelay, schedule);
                } else {
                    // Associate relay GPIO with schedule id
                    let associatedRelay = relays[0];
                    DetermineRequiredRelayStatus(associatedRelay, schedule);
                }
            }
        });

        relaysAreInitialized = true;

        console.log(table.toString());
        console.log('');
    } else {
        console.log('');
        console.log('Grow config is null for some reason...');
        console.log('');
    }
}

function DetermineRequiredRelayStatus(relay, schedule) {
    if (relay) {
        console.log("Checking relay " + relay._gpio);
        if (relay.readSync() !== schedule.currentEvent.status) {
            console.log("Setting " + relay._gpio + " to " + schedule.currentEvent.status);
            relay.writeSync(schedule.currentEvent.status);
            console.log("Relay Status: " + relay.readSync());
            console.log("\r\n");
        } else {
            console.log("Already set correctly");
            console.log("\r\n");
        }
    }
}

