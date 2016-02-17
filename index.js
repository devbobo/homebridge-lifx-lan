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

var Client = new LifxClient();
var Characteristic, Kelvin, PlatformAccessory, Service, UUIDGen;

var fadeDuration;

var fadeDuration;

module.exports = function(homebridge) {
    PlatformAccessory = homebridge.platformAccessory;

    Characteristic = homebridge.hap.Characteristic;
    Service = homebridge.hap.Service;
    UUIDGen = homebridge.hap.uuid;

    Kelvin = function() {
        Characteristic.call(this, 'Kelvin', 'C4E24248-04AC-44AF-ACFF-40164E829DBA')

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

    Kelvin.UUID = 'C4E24248-04AC-44AF-ACFF-40164E829DBA';

    homebridge.registerPlatform("homebridge-lifx-lan", "LifxLan", LifxLanPlatform, true);
};

function LifxLanPlatform(log, config, api) {
    this.config = config || {};

    fadeDuration = config.duration || 1000;

    var self = this;

    this.api = api;
    this.accessories = {};
    this.log = log;

    this.requestServer = http.createServer();
    this.requestServer.listen(18091, function() {
        self.log("Server Listening...");
    });

    Client.on('light-offline', function(bulb) {
        var uuid = UUIDGen.generate(bulb.id);
        var object = self.accessories[uuid];

        if (object !== undefined) {
            if (object instanceof LifxAccessory) {
                self.log("Offline: %s [%s]", object.accessory.displayName, bulb.id);
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
                self.log("Online: %s [%s]", object.accessory.displayName, bulb.id);
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

                self.log("Online: %s [%s]", accessory.displayName, bulb.id);
                self.accessories[uuid] = new LifxAccessory(self.log, accessory, bulb, state);
            });
        }
    });

    this.api.on('didFinishLaunching', function() {
        Client.init({
            debug:                  this.config.debug || false,
            lightOfflineTolerance:  this.config.lightOfflineTolerance || 3,
            messageHandlerTimeout:  this.config.messageHandlerTimeout || 45000,
            resendMaxTimes:         this.config.resendMaxTimes || 3,
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
                var name = state.label || "LiFx " + bulb.id;
                var accessory = new PlatformAccessory(name, UUIDGen.generate(bulb.id));

                accessory.context.make = data.vendorName;
                accessory.context.model = data.productName;

                self.log("Found: %s [%s]", state.label, bulb.id);
                accessory.addService(Service.Lightbulb).addOptionalCharacteristic(Kelvin);
                self.accessories[accessory.UUID] = new LifxAccessory(self.log, accessory, bulb, data);

                self.api.registerPlatformAccessories("homebridge-lifx-lan", "LifxLan", [accessory]);
            });
    });
}

LifxLanPlatform.prototype.configureAccessory = function(accessory) {
    this.accessories[accessory.UUID] = accessory;
}

LifxLanPlatform.prototype.configurationRequestHandler = function(context, request, callback) {
    var respDict = {};

    if (request && request.response) {
        if (request.response.selections) {
            switch(context.onScreen) {
                case "Remove":
                    for (var i in request.response.selections.sort()) {
                        this.removeAccessory(this.sortedAccessories[request.response.selections[i]]);
                    }

                    this.sortedAccessories = null;

                    respDict = {
                        "type": "Interface",
                        "interface": "instruction",
                        "title": "Finished",
                        "detail": "Accessory removal was successful."
                    }

                    context.onScreen = "Complete";
                    callback(respDict);
                    break;
                case "Complete":
                default:
                    callback(respDict, "platform", true, this.config);
                    break;
            }
        }
    }
    else {
        this.sortedAccessories = Object.keys(this.accessories).map(
            function(k){return this[k] instanceof LifxAccessory ? this[k].accessory : this[k]},
            this.accessories
        ).sort(function(a,b) {if (a.displayName < b.displayName) return -1; if (a.displayName > b.displayName) return 1; return 0});
        var names = Object.keys(this.sortedAccessories).map(function(k) {return this[k].displayName}, this.sortedAccessories);

        respDict = {
            "type": "Interface",
            "interface": "list",
            "title": "Select accessory to remove",
            "allowMultipleSelection": true,
            "items": names
        }

        context.onScreen = "Remove";
        callback(respDict);
    }
}

LifxLanPlatform.prototype.removeAccessory = function(accessory) {
    this.log("Remove: %s", accessory.displayName);

    if (this.accessories[accessory.UUID]) {
        delete this.accessories[accessory.UUID];
    }

    this.api.unregisterPlatformAccessories("homebridge-lifx-lan", "LifxLan", [accessory]);
}

function LifxAccessory(log, accessory, bulb, data) {
    this.accessory = accessory;
    this.power = data.power || 0;
    this.color = data.color || {hue: 0, saturation: 0, brightness: 50, kelvin: 2500};
    this.log = log;

    this.updateReachability(bulb, true);
}

LifxAccessory.prototype.get = function (type) {
    var state;

    switch(type) {
        case "brightness":
        case "hue":
        case "kelvin":
        case "saturation":
            this.log("%s - Get %s: %d", this.accessory.displayName, type, this.color[type]);
            state = this.color[type];
            break;
        case "power":
            this.log("%s - Get power: %d", this.accessory.displayName, this.power);
            state = this.power > 0;
            break;
    }

    return state;
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

    this.log("%s - Set %s: %d", this.accessory.displayName, type, value);
    this.color[type] = value;

    this.bulb.color(this.color.hue, this.color.saturation, this.color.brightness, this.color.kelvin, fadeDuration, function (err) {
        callback(null);
    });
}

LifxAccessory.prototype.setPower = function(state, callback) {
    this.log("%s - Set power: %d", this.accessory.displayName, state);

    this.bulb[state ? "on" : "off"](fadeDuration, function(err) {
        callback(null);
    });
}

LifxAccessory.prototype.updateReachability = function(bulb, reachable) {
    this.accessory.updateReachability(reachable);
    this.bulb = bulb;

    var self = this;
    var service = this.accessory.getService(Service.Lightbulb);

    if (reachable === true) {
            service
            .getCharacteristic(Characteristic.On)
            .setValue(this.power > 0)
            .on('get', function(callback) {self.getState("power", callback)})
            .on('set', function(value, callback) {self.setPower(value, callback)});

        service
            .getCharacteristic(Characteristic.Brightness)
            .setValue(this.color.brightness)
            .setProps({minValue: 1})
            .on('get', function(callback) {self.getState("brightness", callback)})
            .on('set', function(value, callback) {self.setColor("brightness", value, callback)});

        service
            .getCharacteristic(Kelvin)
            .setValue(this.color.kelvin)
            .on('get', function(callback) {self.getState("kelvin", callback)})
            .on('set', function(value, callback) {self.setColor("kelvin", value, callback)});

        if (/[Color|Original]/.test(this.accessory.context.model)) {
            service
                .getCharacteristic(Characteristic.Hue)
                .setValue(this.color.hue)
                .on('get', function(callback) {self.getState("hue", callback)})
                .on('set', function(value, callback) {self.setColor("hue", value, callback)});

            service
                .getCharacteristic(Characteristic.Saturation)
                .setValue(this.color.saturation)
                .on('get', function(callback) {self.getState("saturation", callback)})
                .on('set', function(value, callback) {self.setColor("saturation", value, callback)});
        }

        this.accessory
            .getService(Service.AccessoryInformation)
            .setCharacteristic(Characteristic.Manufacturer, this.accessory.context.make)
            .setCharacteristic(Characteristic.Model, this.accessory.context.model)
            .setCharacteristic(Characteristic.SerialNumber, bulb.id);
    }
    else {
        if (service.testCharacteristic(Characteristic.On)) {
            service.getCharacteristic(Characteristic.On).removeAllListeners("get");
            service.getCharacteristic(Characteristic.On).removeAllListeners("set");
        }

        if (service.testCharacteristic(Characteristic.Brightness)) {
            service.getCharacteristic(Characteristic.Brightness).removeAllListeners("get");
            service.getCharacteristic(Characteristic.Brightness).removeAllListeners("set");
        }

        if (service.testCharacteristic(Kelvin)) {
            service.getCharacteristic(Kelvin).removeAllListeners("get");
            service.getCharacteristic(Kelvin).removeAllListeners("set");
        }

        if (/[Color|Original]/.test(this.accessory.context.model)) {
            if (service.testCharacteristic(Characteristic.Hue)) {
                service.getCharacteristic(Characteristic.Hue).removeAllListeners("get");
                service.getCharacteristic(Characteristic.Hue).removeAllListeners("set");
            }

            if (service.testCharacteristic(Characteristic.Saturation)) {
                service.getCharacteristic(Characteristic.Saturation).removeAllListeners("get");
                service.getCharacteristic(Characteristic.Saturation).removeAllListeners("set");
            }
        }
    }
}
