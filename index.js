'use strict';

// LiFx LAN Platform for HomeBridge
//
// Remember to add platform to config.json. Example:
// "platforms": [
//     {
//         "platform": "LifxLan",           // required
//         "name": "LiFx LAN",              // required
//         "timeout": 30,                   // optional: timeout for Discovery (30 sec default)
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

var LifxClient = require('node-lifx').Client;
var LifxLight = require('node-lifx').Light;
var Storage = require('node-persist');

var Client = new LifxClient();
var Characteristic, Kelvin, Service, uuid;

var fadeDuration;

module.exports = function(homebridge) {
    Characteristic = homebridge.hap.Characteristic;
    Service = homebridge.hap.Service;
    uuid = homebridge.hap.uuid;

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
    require('util').inherits(Kelvin, Characteristic);

    homebridge.registerPlatform("homebridge-lifx-lan", "LifxLan", LifxLanPlatform);
};

function LifxLanPlatform(log, config) {
    config = config || {};
    fadeDuration = config.duration || 1000;

    var self = this;

    this.devices = {};
    this.discoveryTimeout = config.timeout || 30;
    this.log = log;

    Client.on('light-offline', function(bulb) {
        var device = self.devices[bulb.id];

        if (device) {
            device.log("Offline: %s [%s]", device.name, device.deviceId);
            device.online = false;
            device.bulb = bulb;
        }
    });

    Client.on('light-online', function(bulb) {
        var device = self.devices[bulb.id];

        if (device) {
            device.log("Online: %s [%s]", device.name, device.deviceId);
            device.online = true;
            device.bulb = bulb;
        }
    });

    Client.init({
        debug:                  config.debug || false,
        lightOfflineTolerance:  config.lightOfflineTolerance || 3,
        messageHandlerTimeout:  config.messageHandlerTimeout || 45000,
        resendMaxTimes:         config.resendMaxTimes || 3,
        resendPacketDelay:      config.resendPacketDelay || 150
    });
}

LifxLanPlatform.prototype = {
    accessories: function(callback) {
        this.log("Starting device discovery...");

        var self = this;
        var discovery = true;
        var foundCount = 0;
        var foundAccessories = [];

        Storage.initSync({dir: this.persistPath()});

        Client.on('light-new', function(bulb) {
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

                    var persist = {id: bulb.id, address: bulb.address, port: bulb.port, label: state.label, vendor: data.vendorName, model: data.productName};
                    Storage.setItemSync(bulb.id, persist);

                    self.log("Found: %s [%s] - %s", state.label, bulb.id, data.productName);

                    if (discovery == true) {
                        var accessory = new LifxBulbAccessory(self.log, bulb, {color: state.color, label: state.label, power: state.power, vendor: data.vendorName, model: data.productName});
                        self.devices[accessory.deviceId] = accessory
                        foundAccessories.push(accessory);
                    }
                });
            });

            foundCount++;
        });

        var timer = setTimeout(
            function () {
                self.log("Stopping device discovery...");
                discovery = false;
                Client.stopDiscovery();

                Storage.forEach(function(key, value) {
                    if (self.devices[key] == undefined) {
                        var bulb = new LifxLight({
                            client: Client,
                            id: value.id,
                            address: value.address,
                            port: value.port,
                            seenOnDiscovery: 0
                        });

                        Client.devices[value.address] = bulb;

                        var accessory = new LifxBulbAccessory(self.log, bulb, {label: value.label, vendor: value.vendor, model: value.model}, false);
                        self.devices[accessory.deviceId] = accessory
                        foundAccessories.push(accessory);
                    }
                });

                callback(foundAccessories);
            },
            this.discoveryTimeout * 1000
        );

        Client.startDiscovery();
    }
}

LifxLanPlatform.prototype.persistPath = function() {
    var path = require('path');

    var home = process.env.HOME || process.env.HOMEPATH || process.env.USERPROFILE;
    return path.join(home, ".homebridge-lifx-lan", "persist");
}

function LifxBulbAccessory(log, bulb, data, online) {
    this.bulb = bulb;
    this.deviceId = bulb.id;
    this.log = log;

    this.name = data.label || "LiFx " + bulb.id;
    this.power = data.power || 0;
    this.color = data.color || {hue: 0, saturation: 0, brightness: 50, kelvin: 2500};

    this.online = online || true;
    this.model = data.model || null;
    this.vendor = data.vendor || null;
}

LifxBulbAccessory.prototype = {
    identify: function(callback) {
        this.log("Identify: %s [%s]", this.name, this.deviceId);
        callback();
    },
    get: function (type) {
        var state;

        switch(type) {
            case "brightness":
            case "hue":
            case "kelvin":
            case "saturation":
                this.log("%s - Get %s: %d", this.name, type, this.color[type]);
                state = this.color[type];
                break;
            case "power":
                this.log("%s - Get power: %d", this.name, this.power);
                state = this.power > 0;
                break;
        }

        return state;
    },
    getServices: function() {
        var self = this;
        var services = [];

        this.services = {
            AccessoryInformation: new Service.AccessoryInformation(),
            Lightbulb: new Service.Lightbulb(this.name)
        };

        this.services.AccessoryInformation
            .setCharacteristic(Characteristic.Manufacturer, this.vendor)
            .setCharacteristic(Characteristic.Model, this.model);

        this.services.Lightbulb.getCharacteristic(Characteristic.On)
            .setValue(this.power > 0)
            .on('get', function(callback) {self.getState("power", callback)})
            .on('set', function(value, callback) {self.setPower(value, callback)}
        );

        this.services.Lightbulb.addCharacteristic(Characteristic.Brightness)
            .setValue(this.color.brightness)
            .setProps({minValue: 1})
            .on('get', function(callback) {self.getState("brightness", callback)})
            .on('set', function(value, callback) {self.setColor("brightness", value, callback)}
        );

        this.services.Lightbulb.addCharacteristic(Kelvin)
            .setValue(this.color.kelvin)
            .on('get', function(callback) {self.getState("kelvin", callback)})
            .on('set', function(value, callback) {self.setColor("kelvin", value, callback)}
        );

        if (/[Color|Original]/.test(this.model)) {
            this.services.Lightbulb.addCharacteristic(Characteristic.Hue)
                .setValue(this.color.hue)
                .on('get', function(callback) {self.getState("hue", callback)})
                .on('set', function(value, callback) {self.setColor("hue", value, callback)}
            );

            this.services.Lightbulb.addCharacteristic(Characteristic.Saturation)
                .setValue(this.color.saturation)
                .on('get', function(callback) {self.getState("saturation", callback)})
                .on('set', function(value, callback) {self.setColor("saturation", value, callback)}
            );
        }

        services.push(this.services.Lightbulb);
        services.push(this.services.AccessoryInformation);

        return services;
    },
    getState: function(type, callback){
        var self = this;
        
        if (this.online === false) {
            callback(null, self.get(type));
            return;
        }

        this.bulb.getState(function(err, data) {
            if (data) {
                self.power = data.power;
                self.color = data.color;
            }

            callback(null, self.get(type));
        });
    },
    setColor: function(type, value, callback){
        var color;

        if (this.online === false) {
            callback(null);
            return;
        }

        this.log("%s - Set %s: %d", this.name, type, value);
        this.color[type] = value;

        this.bulb.color(this.color.hue, this.color.saturation, this.color.brightness, this.color.kelvin, fadeDuration, function (err) {
            callback(null);
        });
    },
    setPower: function(state, callback){
        if (this.online === false) {
            callback(null);
            return;
        }

        this.log("%s - Set power: %d", this.name, state);

        this.bulb[state ? "on" : "off"](fadeDuration, function(err) {
            callback(null);
        });
    }
}
