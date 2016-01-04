'use strict';

// LiFx LAN Platform for HomeBridge
//
// Remember to add platform to config.json. Example:
// "platforms": [
//     {
//         "platform": "LifxLan",   // required
//         "name": "LiFx LAN",      // required
//         "timeout": 30            // optional: timeout for Discovery (30 sec default)
//     }
// ],
//

var storage = require('node-persist');

var LifxClient = require('node-lifx').Client;
var LifxLight = require('node-lifx').Light;

var client = new LifxClient();

function LifxLanPlatform(log, config) {
    var self = this;

    this.devices = {};
    this.discoveryTimeout = config.timeout || 30;
    this.log = log;

    client.on('light-offline', function(bulb) {
        var device = self.devices[bulb.id];

        if (device && device.services) {
            device.log("%s - Offline [%s]", device.name, device.deviceId);
            device.online = false;
            device.bulb = bulb;
            device.services.BridgingState.getCharacteristic(Characteristic.Reachable).setValue(device.online);
        }
    });

    client.on('light-online', function(bulb) {
        var device = self.devices[bulb.id];

        if (device && device.services) {
            device.log("%s - Online [%s]", device.name, device.deviceId);
            device.online = true;
            device.bulb = bulb;
            device.services.BridgingState.getCharacteristic(Characteristic.Reachable).setValue(device.online);
        }
    });

    client.init();
}

LifxLanPlatform.prototype = {
    accessories: function(callback) {
        this.log("Starting device discovery...");

        var self = this;
        var discovery = true;
        var foundCount = 0;
        var foundAccessories = [];

        storage.initSync({dir: this.persistPath()});

        client.on('light-new', function(bulb) {
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
                    storage.setItemSync(bulb.id, persist);

                    self.log("Found: %s [%s]", state.label, data.productName);

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
                client.stopDiscovery();

                storage.forEach(function(key, value) {
                    if (self.devices[key] == undefined) {
                        var bulb = new LifxLight({
                            client: client,
                            id: value.id,
                            address: value.address,
                            port: value.port,
                            seenOnDiscovery: 0
                        });

                        client.devices[value.address] = bulb;

                        var accessory = new LifxBulbAccessory(self.log, bulb, {label: value.label}, false);
                        self.devices[accessory.deviceId] = accessory
                        foundAccessories.push(accessory);
                    }
                });

                callback(foundAccessories);
            },
            this.discoveryTimeout * 1000
        );

        client.startDiscovery();
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
    this.color = data.color || {hue: 0, saturation: 0, brightness: 0, kelvin: 2500};

    this.online = online || true;
    this.model = data.model || null;
    this.vendor = data.vendor || null;
}

LifxBulbAccessory.prototype = {
    getServices: function() {
        var self = this;
        var services = [];

        this.services = {
            AccessoryInformation: new Service.AccessoryInformation(),
            BridgingState: new Service.BridgingState(),
            Lightbulb: new Service.Lightbulb(this.name)
        };

        this.services.AccessoryInformation
            .setCharacteristic(Characteristic.Manufacturer, this.vendor)
            .setCharacteristic(Characteristic.Model, this.model);

        this.services.BridgingState.getCharacteristic(Characteristic.Reachable).setValue(this.online);

        this.services.Lightbulb.getCharacteristic(Characteristic.On)
            .setValue(this.power > 0)
            .on('get', function(callback) {self.getState("power", callback)})
            .on('set', function(value, callback) {self.setPower(value, callback)}
        );
            
        this.services.Lightbulb.addCharacteristic(Characteristic.Brightness)
            .setValue(this.color.brightness)
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
        services.push(this.services.BridgingState);

        return services;
    },
    getState: function(type, callback){
        var self = this;
        
        if (this.online === false) {
            callback(new Error("Device not found"), false);
            return;
        }

        this.bulb.getState(function(err, data) {
            if (err !== null) {
                callback(new Error("Device not found"), false);
                return;
            }

            self.power = data.power;
            self.color = data.color;

            switch(type) {
                case "brightness":
                case "hue":
                case "kelvin":
                case "saturation":
                    self.log("%s - Get %s: %d", self.name, type, self.color[type]);
                    callback(null, self.color[type]);
                    break;
                case "power":
                    self.log("%s - Get power: %d", self.name, self.power);
                    callback(null, self.power > 0);
                    break;
            }
        });
    },
    setColor: function(type, value, callback){
        var color;

        if (this.online === false) {
            callback(new Error("Device not found"), false);
            return;
        }

        this.log("%s - Set %s: %d", this.name, type, value);
        this.color[type] = value;

        this.bulb.color(this.color.hue, this.color.saturation, this.color.brightness, this.color.kelvin, 0, function (err) {
            if (err) {
                callback(new Error("Device not found"), false);
                return;
            }

            callback(null);
        });
    },
    setPower: function(state, callback){
        if (this.online === false) {
            callback(new Error("Device not found"), false);
            return;
        }

        this.log("%s - Set power: %d", this.name, state);

        this.bulb[state ? "on" : "off"](0, function(err){
            if (err) {
                callback(new Error("Device not found"), false);
                return;
            }

            callback(null);
        });
    }
}

module.exports.accessory = LifxBulbAccessory;
module.exports.platform = LifxLanPlatform;

var Characteristic, Kelvin, Service, uuid;

module.exports = function(homebridge) {
    Characteristic = homebridge.hap.Characteristic;
    Service = homebridge.hap.Service;
    uuid = homebridge.hap.uuid;

    Kelvin = function() {
        Characteristic.call(this, 'Kelvin', 'C4E24248-04AC-44AF-ACFF-40164e829DBA')

        this.setProps({
            format: Characteristic.Formats.UINT16,
            unit: 'kelvin',
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
