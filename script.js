const gpio = require('onoff').Gpio;

const connectedGreenLED = new gpio(16, 'out');
const tempGreenLED = new gpio(25, 'out');
const luxGreenLED = new gpio(24, 'out');
const blueLED = new gpio(23, 'out');

var raspberryPiId = "robo_001";
var raspberryPiGrowId = "5e38b4e4d1f93ee2fdf26a31";

var tempSensor = require("node-dht-sensor");

const Tsl2561 = require("ada-tsl2561");
const lumenSensor = new Tsl2561();

var WebSocket = require('ws');

// TODO: Fetch this JWT automatically
var ws = new WebSocket("ws://192.168.0.224:8080", {
    headers: {
        token: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJfaWQiOiI1ZWIwNTE5YTAyODhlYTMwZDA0NmEyYTkiLCJ1c2VybmFtZSI6Il" +
        "pvcGUiLCJlbWFpbCI6InNkZW5vbW1lMTVAZ21haWwuY29tIiwidHlwZSI6MCwicGFzc3dvcmQiOiIkMmEkMTAkNXM2dE12bzYuOVFlQWln" +
        "SHdBck51T3VPUHFLL2Nyc2FXVjFmR0xPY3R1dW9sc1BMRVBlVS4iLCJjcmVhdGVEYXRlIjoiMjAyMC0wNS0wNFQxNzozMjoxMC41NTBaIi" +
        "wibGFzdExvZ2luRGF0ZSI6IjIwMjAtMDUtMDRUMTc6MzI6MTAuNTUwWiIsIl9fdiI6MCwiaWF0IjoxNTkxNzI3NjA3LCJleHAiOjE1OTE4" +
        "MTQwMDd9.blL3bNtqZvAyhGcspk9L-7YPRjTAAdEGT9J8K-1FKe0",
        user: {
            email: "sdenomme15@gmail.com",
            password: "pasteFlux1992"
        }
    }
});

var dataHandler;
var relayHandler;

var currentGrow;
var currentGrowConfig;

ws.on('open', function () {
    console.log('Connection successfully opened to server.');
    console.log('Turning on green connectivity LED.');
    connectedGreenLED.writeSync(1);
});

ws.on('close', function close() {
    console.log('Connection broken to server.');
    console.log('Turning off green connectivity LED.');
    connectedGreenLED.writeSync(0);

    console.log('Stopping data send handler.');
    clearInterval(dataHandler);
});

// TODO: Come up with a better way to identify specific events
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
                scriptId: raspberryPiId,
                identify: true
            }));
        }

        if (data.send) {
            currentGrow = data.grow;
            currentGrowConfig = data.config;

            AnalyzeRelays();

            dataHandler = setInterval(AttemptToGetDataFromSensors, 30000);
        }

        // Is relay manual override?
        if (data.relayOverride) {
            // Collect GPIO pin and attempt to turn it on / off
        }
    }
});

async function AttemptToGetDataFromSensors() {
    // TODO: Determine if any relays need to be toggled.

    tempSensor.read(22, 4, function (err, temperature, humidity) {
        if (!err) {
            var cTemp = temperature;
            var fTemp = (cTemp * 9 / 5 + 32).toFixed(2);

            if (fTemp && fTemp != 0.0) {
                tempGreenLED.writeSync(1);
            }

            getLumen().then(function (luxObj) {
                if (luxObj && luxObj.broadband) {
                    luxGreenLED.writeSync(1);
                }

                blueLED.writeSync(1);

                console.log("");
                console.log("Sending sensor data now.");

                ws.send(JSON.stringify({
                    growId: raspberryPiGrowId,
                    temp: fTemp,
                    humidity: humidity.toFixed(2),
                    infrared: luxObj.infrared.toFixed(2),
                    lux: luxObj.lux.toFixed(2),
                    createGrowEvent: true
                }));

                luxGreenLED.writeSync(0);
                tempGreenLED.writeSync(0);
                blueLED.writeSync(0);
            });
        }
    });
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

const relays = [
    new gpio(17, 'out'),
    new gpio(27, 'out')
];

var nodeSchedule = require('node-schedule');

// Check if a relay needs to be turned on or off
function AnalyzeRelays() {
    console.log('\tScheduling relay events...');

    if (currentGrowConfig && currentGrowConfig.relaySchedules) {
        var relaySchedules = currentGrowConfig.relaySchedules;
        // For each schedule
        relaySchedules.forEach((schedule, index) => {
            // Get current event, and next event by looking at current time
            // Check every event, if current time is past
            schedule.events.forEach((event, index) => {
                var nextEvent = schedule.events[(index + 1 < schedule.events.length) ? index + 1 : 0];
                if (event.triggerTime && nextEvent.triggerTime) {
                    var triggerTime = event.triggerTime.split(":");

                    var triggerTimeHours = parseInt(triggerTime[0]);
                    var triggerTimeMinutes = parseInt(triggerTime[1]);
                    var triggerTimeSeconds = parseInt(triggerTime[2]);

                    console.log('\t' + triggerTimeHours + ":" + triggerTimeMinutes + ':' + triggerTimeSeconds + ' - ' + event.Description);

                    nodeSchedule.scheduleJob({
                        hour: triggerTimeHours,
                        minute: triggerTimeMinutes,
                        second: triggerTimeSeconds
                    }, function () {
                        console.log(new Date() + ' FIRE JOB: ' + event.status + ' -- ' + event.Description);
                        relays[schedule.type].writeSync(event.status);
                        console.log('Relay Status: ' + relays[schedule.type].readSync());
                    });
                }
            });
        });
    } else {
        console.log('');
        console.log('Grow config is null for some reason...');
        console.log('');
    }
}