'use strict';

// LiFx LAN Platform for HomeBridge
//
// Remember to add platform to config.json. Example:
// "platforms": [
//     {
//         "platform": "LifxLan",           // required
//         "name": "LiFx LAN",              // required

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

var LifxClient = require('node-lifx').Client;
var LifxLight = require('node-lifx').Light;

var Client = new LifxClient();
var Characteristic, Kelvin, PlatformAccessory, Service, UUIDGen;

module.exports = function(homebridge) {
    PlatformAccessory = homebridge.platformAccessory;

    Characteristic = homebridge.hap.Characteristic;
    Service = homebridge.hap.Service;
    UUIDGen = homebridge.hap.uuid;

    Kelvin = function() {
        Characteristic.call(this, 'Kelvin', 'C4E24248-04AC-44AF-ACFF-40164e829DBA')

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

    homebridge.registerPlatform("homebridge-lifx-lan", "LifxLan", LifxLanPlatform, true);
};

function LifxLanPlatform(log, config, api) {
    config = config || {};

    var self = this;

    this.api = api;
    this.accessories = [];
    this.configured = [];
    this.log = log;

    Client.on('light-offline', function(bulb) {
        var key;
        var uuid = UUIDGen.generate(bulb.id);

        if (self.configured.indexOf(uuid) !== -1) {
            for (var index in self.accessories) {
                if (self.accessories[index].UUID == uuid) {
                    key = index;
                    break;
                }
            }
        }

        if (key) {
            var accessory = self.accessories[key];

            self.log("Offline: %s [%s]", accessory.displayName, bulb.id);
            accessory.updateReachability(false);
            accessory.bulb = bulb;

            var service = accessory.getService(Service.Lightbulb);
            service.getCharacteristic(Characteristic.On).removeAllListeners("get");
            service.getCharacteristic(Characteristic.On).removeAllListeners("set");

            service.getCharacteristic(Characteristic.Brightness).removeAllListeners("get");
            service.getCharacteristic(Characteristic.Brightness).removeAllListeners("set");

            if (/[Color|Original]/.test(self.accessories[key].getService(Service.AccessoryInformation).getCharacteristic(Characteristic.Model))) {
                service.getCharacteristic(Characteristic.Hue).removeAllListeners("get");
                service.getCharacteristic(Characteristic.Hue).removeAllListeners("set");

                service.getCharacteristic(Characteristic.Saturation).removeAllListeners("get");
                service.getCharacteristic(Characteristic.Saturation).removeAllListeners("set");
            }

            self.accessories[key] = accessory;
        }
    });

    Client.on('light-online', function(bulb) {
        var key;
        var uuid = UUIDGen.generate(bulb.id);

        if (self.configured.indexOf(uuid) !== -1) {
            for (var index in self.accessories) {
                if (self.accessories[index].UUID == uuid) {
                    key = index;
                    break;
                }
            }
        }

        if (key) {
            self.log("Online: %s [%s]", self.accessories[key].displayName, bulb.id);
            self.accessories[key].updateReachability(true);
            self._setupAccessory(self.accessories[key], bulb);
        }
    });

    Client.on('light-new', function(bulb) {
        var uuid = UUIDGen.generate(bulb.id);

        if (self.configured.indexOf(uuid) == -1) {
            self.addAccessory(bulb);
        }
        else {
            for (var index in self.accessories) {
                if (self.accessories[index].UUID == uuid) {
                    self._setupAccessory(self.accessories[index], bulb);
                    break;
                }
            }
        }
    });

    this.api.on('didFinishLaunching', function() {
        Client.init({
            debug:                  config.debug || false,
            lightOfflineTolerance:  config.lightOfflineTolerance || 3,
            messageHandlerTimeout:  config.messageHandlerTimeout || 45000,
            resendMaxTimes:         config.resendMaxTimes || 3,
            resendPacketDelay:      config.resendPacketDelay || 150
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

            var name = state.label || "LiFx " + bulb.id;
            var accessory = new PlatformAccessory(name, UUIDGen.generate(bulb.id));

            self.log("Found: %s [%s]", state.label, bulb.id);
            accessory.addService(Service.Lightbulb);
            self._initAccessory(accessory, bulb, state);
    });
}

LifxLanPlatform.prototype.configureAccessory = function(accessory) {
    this.log("Cached: %s", accessory.displayName);
    this.configured.push(accessory.UUID);
    this.accessories.push(accessory);
}

LifxLanPlatform.prototype._setupAccessory = function(accessory, bulb) {
    var self = this;

    bulb.getState(function(err, state) {
        if (err) {
            state = {
                label: bulb.client.label
            }
        }

        self._initAccessory(accessory, bulb, state);
    });
}

LifxLanPlatform.prototype._initAccessory = function(accessory, bulb, data) {
    var self = this;

    accessory.bulb = bulb;
    accessory.power = data.power || 0;
    accessory.color = data.color || {hue: 0, saturation: 0, brightness: 50, kelvin: 2500};

    var characteristic
    var service = accessory.getService(Service.Lightbulb);

    service
        .getCharacteristic(Characteristic.On)
        .setValue(accessory.power > 0)
        .on('get', function(callback) {self._getState(accessory, "power", callback)})
        .on('set', function(value, callback) {self._setPower(accessory, value, callback)});

    service
        .getCharacteristic(Characteristic.Brightness)
        .setValue(accessory.color.brightness)
        .setProps({minValue: 1})
        .on('get', function(callback) {self._getState(accessory, "brightness", callback)})
        .on('set', function(value, callback) {self._setColor(accessory, "brightness", value, callback)});

    /*
    service
        .getCharacteristic(Kelvin)
        .setValue(accessory.color.kelvin)
        .on('get', function(callback) {self._getState(accessory, "kelvin", callback)})
        .on('set', function(value, callback) {self._setColor(accessory, "kelvin", value, callback)});
    */

    accessory.updateReachability(true);

    bulb.getHardwareVersion(function(err, data) {
        accessory
            .getService(Service.AccessoryInformation)
            .setCharacteristic(Characteristic.Manufacturer, data.vendorName)
            .setCharacteristic(Characteristic.Model, data.productName)
            .setCharacteristic(Characteristic.SerialNumber, bulb.id);

        if (/[Color|Original]/.test(data.productName)) {
            service
                .getCharacteristic(Characteristic.Hue)
                .setValue(accessory.color.hue)
                .on('get', function(callback) {self._getState(accessory, "hue", callback)})
                .on('set', function(value, callback) {self._setColor(accessory, "hue", value, callback)});

            service
                .getCharacteristic(Characteristic.Saturation)
                .setValue(accessory.color.saturation)
                .on('get', function(callback) {self._getState(accessory, "saturation", callback)})
                .on('set', function(value, callback) {self._setColor(accessory, "saturation", value, callback)});
        }

        if (self.configured.indexOf(accessory.UUID) === -1) {
            self.configured.push(accessory.UUID);
            self.accessories.push(accessory);
            self.api.registerPlatformAccessories("homebridge-lifx-lan", "LifxLan", [accessory]);
        }
    });
}

LifxLanPlatform.prototype._get = function (accessory, type) {
    var state;

    switch(type) {
        case "brightness":
        case "hue":
        case "kelvin":
        case "saturation":
            this.log("%s - Get %s: %d", accessory.displayName, type, accessory.color[type]);
            state = accessory.color[type];
            break;
        case "power":
            this.log("%s - Get power: %d", accessory.displayName, accessory.power);
            state = accessory.reachable && accessory.power > 0;
            break;
    }

    return state;
}

LifxLanPlatform.prototype._getState = function(accessory, type, callback){
    var self = this;

    if (accessory.reachable === false) {
        callback(null, self._get(accessory, type));
        return;
    }

    accessory.bulb.getState(function(err, data) {
        if (data) {
            accessory.power = data.power;
            accessory.color = data.color;
        }

        callback(null, self._get(accessory, type));
    });
}

LifxLanPlatform.prototype._setColor = function(accessory, type, value, callback){
        var color;

        if (accessory.reachable === false) {
            callback(null);
            return;
        }

        this.log("%s - Set %s: %d", accessory.displayName, type, value);
        accessory.color[type] = value;

        accessory.bulb.color(accessory.color.hue, accessory.color.saturation, accessory.color.brightness, accessory.color.kelvin, 0, function (err) {
            callback(null);
        });
    }

LifxLanPlatform.prototype._setPower = function(accessory, state, callback){
    if (accessory.reachable === false) {
        callback(null);
        return;
    }

    this.log("%s - Set power: %d", accessory.displayName, state);

    accessory.bulb[state ? "on" : "off"](0, function(err) {
        callback(null);
    });
}
