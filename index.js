'use strict';

// LiFx LAN Platform for HomeBridge
//
// Remember to add platform to config.json. Example:
// "platforms": [
//     {
//         "platform": "LifxLan",           // required
//         "name": "LiFx LAN",              // required
//         "duration": 1000,                // optional, the time to fade on/off in milliseconds

//         ** optional node-lifx parameters **
//         "broadcast": '255.255.255.255',   // optional: Broadcast address for bulb discovery
//         "lightOfflineTolerance": 3,       // optional: A light is offline if not seen for the given amount of discoveries
//         "messageHandlerTimeout": 45000,   // optional: in ms, if not answer in time an error is provided to get methods
//         "resendPacketDelay": 150,         // optional: delay between packages if light did not receive a packet (for setting methods with callback)
//         "resendMaxTimes": 3,              // optional: resend packages x times if light did not receive a packet (for setting methods with callback)
//         "debug": false                    // optional: logs all messages in console if turned on
//     }
// ],
//

var inherits = require('util').inherits;
var http = require('http');

var LifxClient = require('node-lifx').Client;
var LifxLight = require('node-lifx').Light;
var LifxPacket = require('node-lifx').packet;
var LifxConstants = require('node-lifx').constants;

var Client = new LifxClient();
var Characteristic, Kelvin, PlatformAccessory, Service, UUIDGen;

var fadeDuration;

const UUID_KELVIN = 'C4E24248-04AC-44AF-ACFF-40164E829DBA';

module.exports = function(homebridge) {
    PlatformAccessory = homebridge.platformAccessory;

    Characteristic = homebridge.hap.Characteristic;
    Service = homebridge.hap.Service;
    UUIDGen = homebridge.hap.uuid;

    Kelvin = function() {
        Characteristic.call(this, 'Kelvin', UUID_KELVIN)

        this.setProps({
            format: Characteristic.Formats.UINT16,
            unit: 'K',
            maxValue: 9000,
            minValue: 2500,
            minStep: 250,
            perms: [Characteristic.Perms.READ, Characteristic.Perms.WRITE, Characteristic.Perms.NOTIFY]
        });

        this.value = this.getDefaultValue();
    };
    inherits(Kelvin, Characteristic);

    Kelvin.UUID = UUID_KELVIN;

    homebridge.registerPlatform("homebridge-lifx-lan", "LifxLan", LifxLanPlatform, true);
};

function LifxLanPlatform(log, config, api) {
    this.config = config || {};

    fadeDuration = this.config.duration || 1000;

    var self = this;

    this.api = api;
    this.accessories = {};
    this.log = log;

    this.requestServer = http.createServer();

    this.requestServer.on('error', function(err) {

    });

    this.requestServer.listen(18091, function() {
        self.log("Server Listening...");
    });

    Client.on('light-offline', function(bulb) {
        var uuid = UUIDGen.generate(bulb.id);
        var object = self.accessories[uuid];

        if (object !== undefined) {
            if (object instanceof LifxAccessory) {
                self.log("Offline: %s [%s]", object.accessory.context.name, bulb.id);
                object.updateReachability(bulb, false);
            }
        }
    });

    Client.on('light-online', function(bulb) {
        var uuid = UUIDGen.generate(bulb.id);
        var object = self.accessories[uuid];

        if (object === undefined) {
            self.addAccessory(bulb);
        }
        else {
            if (object instanceof LifxAccessory) {
                self.log("Online: %s [%s]", object.accessory.context.name, bulb.id);
                object.updateReachability(bulb, true);
            }
        }
    });

    Client.on('light-new', function(bulb) {
        var uuid = UUIDGen.generate(bulb.id);
        var accessory = self.accessories[uuid];

        if (accessory === undefined) {
            self.addAccessory(bulb);
        }
        else {
            bulb.getState(function(err, state) {
                if (err) {
                    state = {
                        label: bulb.client.label
                    }
                }

                self.log("Online: %s [%s]", accessory.context.name, bulb.id);
                self.accessories[uuid] = new LifxAccessory(self.log, accessory, bulb, state);
            });
        }
    });

    this.api.on('didFinishLaunching', function() {
        Client.init({
            debug:                  this.config.debug || false,
            broadcast:              this.config.broadcast || '255.255.255.255',
            lightOfflineTolerance:  this.config.lightOfflineTolerance || 5,
            messageHandlerTimeout:  this.config.messageHandlerTimeout || 45000,
            resendMaxTimes:         this.config.resendMaxTimes || 4,
            resendPacketDelay:      this.config.resendPacketDelay || 150
        });
    }.bind(this));
}

LifxLanPlatform.prototype.addAccessory = function(bulb, data) {
    var self = this;

    bulb.getState(function(err, state) {
            if (err) {
                state = {
                    label: bulb.client.label
                }
            }

            bulb.getHardwareVersion(function(err, data) {
                if (err) {
                    data = {}
                }

                var name = "LIFX " + bulb.id.replace(/d073d5/, "");
                var accessory = new PlatformAccessory(name, UUIDGen.generate(bulb.id));

                accessory.context.name = state.label || name;
                accessory.context.make = data.vendorName || "LIFX";
                accessory.context.model = data.productName || "Unknown";

                accessory.getService(Service.AccessoryInformation)
                    .setCharacteristic(Characteristic.Manufacturer, accessory.context.make)
                    .setCharacteristic(Characteristic.Model, accessory.context.model)
                    .setCharacteristic(Characteristic.SerialNumber, bulb.id);

                self.log("Found: %s [%s]", accessory.context.name, bulb.id);

                var service = accessory.addService(Service.Lightbulb, accessory.context.name);

                service.addCharacteristic(Characteristic.Brightness);
                service.addCharacteristic(Kelvin);

                if (/(Color|Original)/.test(accessory.context.model)) {
                    service.addCharacteristic(Characteristic.Hue);
                    service.addCharacteristic(Characteristic.Saturation);
                }

                if (/(650|Original)/.test(accessory.context.model) === false) {
                    service.addCharacteristic(Characteristic.CurrentAmbientLightLevel);
                }

                self.accessories[accessory.UUID] = new LifxAccessory(self.log, accessory, bulb, data);

                self.api.registerPlatformAccessories("homebridge-lifx-lan", "LifxLan", [accessory]);
            });
    });
}

LifxLanPlatform.prototype.configureAccessory = function(accessory) {
    this.accessories[accessory.UUID] = accessory;
}

LifxLanPlatform.prototype.configurationRequestHandler = function(context, request, callback) {
    var self = this;
    var respDict = {};

    if (request && request.type === "Terminate") {
        context.onScreen = null;
    }

    var sortAccessories = function() {
        context.sortedAccessories = Object.keys(self.accessories).map(
            function(k){return this[k] instanceof PlatformAccessory ? this[k] : this[k].accessory},
            self.accessories
        ).sort(function(a,b) {if (a.context.name < b.context.name) return -1; if (a.context.name > b.context.name) return 1; return 0});

        return Object.keys(context.sortedAccessories).map(function(k) {return this[k].context.name}, context.sortedAccessories);
    }

    switch(context.onScreen) {
        case "DoRemove":
            if (request.response.selections) {
                for (var i in request.response.selections.sort()) {
                    this.removeAccessory(context.sortedAccessories[request.response.selections[i]]);
                }

                respDict = {
                    "type": "Interface",
                    "interface": "instruction",
                    "title": "Finished",
                    "detail": "Accessory removal was successful."
                }

                context.onScreen = null;
                callback(respDict);
            }
            else {
                context.onScreen = null;
                callback(respDict, "platform", true, this.config);
            }
            break;
        case "DoModify":
            context.accessory = context.sortedAccessories[request.response.selections[0]];
            context.canAddCharacteristic = [];
            context.canRemoveCharacteristic = [];

            var service = context.accessory.getService(Service.Lightbulb);
            var characteristics;

            if (/(650|Original)/.test(context.accessory.context.model)) {
                characteristics = [Characteristic.Brightness, Characteristic.Hue, Kelvin, Characteristic.Saturation];
            }
            else if (/Color/.test(context.accessory.context.model)) {
                characteristics = [Characteristic.Brightness, Characteristic.CurrentAmbientLightLevel, Characteristic.Hue, Kelvin, Characteristic.Saturation];
            }
            else {
                characteristics = [Characteristic.Brightness, Characteristic.CurrentAmbientLightLevel, Kelvin];
            }

            for (var index in characteristics) {
                var characteristic = characteristics[index];

                if (service.testCharacteristic(characteristic)) {
                    context.canRemoveCharacteristic.push(characteristic);
                }
                else {
                    context.canAddCharacteristic.push(characteristic);
                }
            }

            var items = [];

            if (context.canAddCharacteristic.length > 0) {
                items.push("Add Characteristic");
            }

            if (context.canRemoveCharacteristic.length > 0) {
                items.push("Remove Characteristic");
            }

            respDict = {
                "type": "Interface",
                "interface": "list",
                "title": "Select action for " + context.accessory.context.name,
                "allowMultipleSelection": false,
                "items": items
            }

            context.onScreen = "ModifyCharacteristic";

            callback(respDict);
            break;
        case "ModifyCharacteristic":
            if (context.canAddCharacteristic.length > 0) {
                context.onScreen = context.canRemoveCharacteristic.length > 0 && request.response.selections[0] == 1 ? "RemoveCharacteristic" : "AddCharacteristic";
            }
            else {
                context.onScreen = "RemoveCharacteristic";
            }

            var items = [];

            for (var index in context["can" + context.onScreen]) {
                var characteristic = new (Function.prototype.bind.apply(context["can" + context.onScreen][index], arguments));
                items.push(characteristic.displayName);
            }

            respDict = {
                "type": "Interface",
                "interface": "list",
                "title": "Select characteristc to " + (context.onScreen == "RemoveCharacteristic" ? "remove" : "add"),
                "allowMultipleSelection": true,
                "items": items
            }

            callback(respDict);
            break;
        case "AddCharacteristic":
        case "RemoveCharacteristic":
            if (request.response.selections) {
                var service = context.accessory.getService(Service.Lightbulb);

                for (var i in request.response.selections.sort()) {
                    var item = context["can" + context.onScreen][i];
                    var characteristic = service.getCharacteristic(item);

                    if (context.onScreen == "RemoveCharacteristic") {
                        service.removeCharacteristic(characteristic);
                    }
                    else {
                        if (characteristic == null) {
                            service.addCharacteristic(item);
                        }

                        if (self.accessories[context.accessory.UUID] instanceof LifxAccessory) {
                            self.accessories[context.accessory.UUID].updateEventHandlers(item);
                        }
                    }
                }

                respDict = {
                    "type": "Interface",
                    "interface": "instruction",
                    "title": "Finished",
                    "detail": "Accessory characteristic " + (context.onScreen == "RemoveCharacteristic" ? "removal" : "addition") + " was successful."
                }

                context.onScreen = null;
                callback(respDict);
            }
            else {
                context.onScreen = null;
                callback(respDict, "platform", true, this.config);
            }
            break;
        case "Menu":
            context.onScreen = request && request.response && request.response.selections[0] == 1 ? "Remove" : "Modify";
        case "Modify":
        case "Remove":
            respDict = {
                "type": "Interface",
                "interface": "list",
                "title": "Select accessory to " + context.onScreen.toLowerCase(),
                "allowMultipleSelection": context.onScreen == "Remove",
                "items": sortAccessories()
            }

            context.onScreen = "Do" + context.onScreen;
            callback(respDict);
            break;
        default:
            if (request && (request.response || request.type === "Terminate")) {
                context.onScreen = null;
                callback(respDict, "platform", true, this.config);
            }
            else {
                respDict = {
                    "type": "Interface",
                    "interface": "list",
                    "title": "Select option",
                    "allowMultipleSelection": false,
                    "items": ["Modify Accessory", "Remove Accessory"]
                }

                context.onScreen = "Menu";
                callback(respDict);
            }
    }
}

LifxLanPlatform.prototype.removeAccessory = function(accessory) {
    this.log("Remove: %s", accessory.context.name);

    if (this.accessories[accessory.UUID]) {
        delete this.accessories[accessory.UUID];
    }

    this.api.unregisterPlatformAccessories("homebridge-lifx-lan", "LifxLan", [accessory]);
}

function LifxAccessory(log, accessory, bulb, data) {
    var self = this;
    this.accessory = accessory;
    this.power = data.power || 0;
    this.color = data.color || {hue: 0, saturation: 0, brightness: 50, kelvin: 2500};
    this.log = log;

    if (!this.accessory instanceof PlatformAccessory) {
        this.log("ERROR \n", this);
        return;
    }

    if (this.accessory.context.name === undefined) {
        this.accessory.context.name = this.accessory.displayName;
    }

    var service = this.accessory.getService(Service.Lightbulb);

    if (service.testCharacteristic(Characteristic.Name) === false) {
        service.addCharacteristic(Characteristic.Name);
    }

    if (service.getCharacteristic(Characteristic.Name).value === undefined) {
        service.getCharacteristic(Characteristic.Name).setValue(this.accessory.context.name);
    }

    this.accessory.on('identify', function(paired, callback) {
        self.log("%s - identify", self.accessory.context.name);
        callback();
    });

    this.updateReachability(bulb, true);
}

LifxAccessory.prototype.get = function (type) {
    var state;

    switch(type) {
        case "brightness":
        case "hue":
        case "kelvin":
        case "saturation":
            this.log("%s - Get %s: %d", this.accessory.context.name, type, this.color[type]);
            state = this.color[type];
            break;
        case "power":
            this.log("%s - Get power: %d", this.accessory.context.name, this.power);
            state = this.power > 0;
            break;
    }

    return state;
}

LifxAccessory.prototype.getAmbientLight = function(callback) {
    var self = this;

    this.bulb.getAmbientLight(function(err, data) {
        var lux;

        if (data) {
            lux = parseInt(data * 1000) / 1000;
        }

        self.log("%s - Get ambient light: %d", self.accessory.context.name, lux);
        callback(null, lux);
    });
}

LifxAccessory.prototype.getState = function(type, callback){
    var self = this;

    this.bulb.getState(function(err, data) {
        if (data) {
            self.power = data.power;
            self.color = data.color;
        }

        callback(null, self.get(type));
    });
}

LifxAccessory.prototype.setColor = function(type, value, callback){
    var color;

    this.log("%s - Set %s: %d", this.accessory.context.name, type, value);
    this.color[type] = value;

    this.bulb.color(this.color.hue, this.color.saturation, this.color.brightness, this.color.kelvin, fadeDuration, function (err) {
        callback(null);
    });
}

LifxAccessory.prototype.setPower = function(state, callback) {
    this.log("%s - Set power: %d", this.accessory.context.name, state);

    this.bulb[state ? "on" : "off"](fadeDuration, function(err) {
        callback(null);
    });
}

LifxAccessory.prototype.setWaveform = function(hue, period, cycles, skewRatio, waveform, callback) {
    var light = this.accessory.getService(Service.Lightbulb);

    var packetObj = LifxPacket.create('setWaveform', {
        isTransient: true,
        color: {
            hue: parseInt(hue * 65535 / 360),
            saturation: 65535,
            brightness: 65535,
            kelvin: 3500
        },
        period: period,
        cycles: cycles,
        skewRatio: skewRatio,
        // [0] = SAW, [1] = SINE, [2] = HALF_SINE, [3] = TRIANGLE, [4] = PULSE
        waveform: waveform
    }, Client.source);

    packetObj.target = this.bulb.id; // light id

    Client.send(packetObj, function() {
        if (callback) {
            callback(null);
        }
    });
}

LifxAccessory.prototype.updateInfo = function() {
    var self = this;

    var model = this.accessory.getService(Service.AccessoryInformation).getCharacteristic(Characteristic.Model).value;

    if (model !== "Unknown" && model !== "Default-Model") {
        return;
    }

    this.bulb.getHardwareVersion(function(err, data) {
        if (err) {
            data = {}
        }

        self.accessory.context.make = data.vendorName || "LIFX";
        self.accessory.context.model = data.productName || "Unknown";

        self.accessory.getService(Service.AccessoryInformation)
            .setCharacteristic(Characteristic.Manufacturer, self.accessory.context.make)
            .setCharacteristic(Characteristic.Model, self.accessory.context.model)
            .setCharacteristic(Characteristic.SerialNumber, self.bulb.id);

        if (/(Color|Original)/.test(self.accessory.context.model)) {
            var service = self.accessory.getService(Service.Lightbulb);

            if (service.testCharacteristic(Characteristic.Hue) === false) {
                service.addCharacteristic(Characteristic.Hue);
                self.updateEventHandlers(Characteristic.Hue);
            }

            if (service.testCharacteristic(Characteristic.Saturation) === false) {
                service.addCharacteristic(Characteristic.Saturation);
                self.updateEventHandlers(Characteristic.Saturation);
            }
        }
    });
}

LifxAccessory.prototype.updateEventHandlers = function(characteristic) {
    var self = this;
    var service = this.accessory.getService(Service.Lightbulb);

    if (service.testCharacteristic(characteristic) === false) {
        return;
    }

    service.getCharacteristic(characteristic).removeAllListeners();

    if (this.accessory.reachable !== true) {
        return;
    }

    switch(characteristic) {
        case Characteristic.On:
            service
                .getCharacteristic(Characteristic.On)
                .setValue(this.power > 0)
                .on('get', function(callback) {self.getState("power", callback)})
                .on('set', function(value, callback) {self.setPower(value, callback)});
            break;
        case Characteristic.Brightness:
            service
                .getCharacteristic(Characteristic.Brightness)
                .setValue(this.color.brightness)
                .setProps({minValue: 1})
                .on('get', function(callback) {self.getState("brightness", callback)})
                .on('set', function(value, callback) {self.setColor("brightness", value, callback)});
            break;
        case Characteristic.CurrentAmbientLightLevel:
            service
                .getCharacteristic(Characteristic.CurrentAmbientLightLevel)
                .on('get', function(callback) {self.getAmbientLight(callback)});
            break;
        case Kelvin:
            service
                .getCharacteristic(Kelvin)
                .setValue(this.color.kelvin)
                .on('get', function(callback) {self.getState("kelvin", callback)})
                .on('set', function(value, callback) {self.setColor("kelvin", value, callback)});
            break;
        case Characteristic.Hue:
            service
                .getCharacteristic(Characteristic.Hue)
                .setValue(this.color.hue)
                .on('get', function(callback) {self.getState("hue", callback)})
                .on('set', function(value, callback) {self.setColor("hue", value, callback)});
            break;
        case Characteristic.Saturation:
            service
                .getCharacteristic(Characteristic.Saturation)
                .setValue(this.color.saturation)
                .on('get', function(callback) {self.getState("saturation", callback)})
                .on('set', function(value, callback) {self.setColor("saturation", value, callback)});
            break;
    }
}

LifxAccessory.prototype.updateReachability = function(bulb, reachable) {
    this.accessory.updateReachability(reachable);
    this.bulb = bulb;

    this.updateEventHandlers(Characteristic.On);
    this.updateEventHandlers(Characteristic.Brightness);
    this.updateEventHandlers(Characteristic.CurrentAmbientLightLevel);
    this.updateEventHandlers(Kelvin);

    if (/(Color|Original)/.test(this.accessory.context.model)) {
        this.updateEventHandlers(Characteristic.Hue);
        this.updateEventHandlers(Characteristic.Saturation);
    }

    if (reachable === true) {
        this.updateInfo();
    }
}
