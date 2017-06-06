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
//         "debug": false,                   // optional: logs all messages in console if turned on
//         "address": '0.0.0.0'              // optional: specify which ipv4 address to bind to
//     }
// ],
//

var inherits = require('util').inherits;

var LifxClient = require('node-lifx').Client;
var LifxLight = require('node-lifx').Light;
var LifxPacket = require('node-lifx').packet;
var LifxConstants = require('node-lifx').constants;

var Client = new LifxClient();
var Characteristic, ColorTemperature, Kelvin, PlatformAccessory, Service, UUIDGen;

var fadeDuration;

const UUID_KELVIN = 'C4E24248-04AC-44AF-ACFF-40164E829DBA';
const UUID_COLOR_TEMPERATURE = '000000CE-0000-1000-8000-0026BB765291';

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

    ColorTemperature = function() {
        Characteristic.call(this, 'Color Temperature', UUID_COLOR_TEMPERATURE)

        this.setProps({
            format: Characteristic.Formats.UINT32,
            maxValue: 400,
            minValue: 112,
            minStep: 1,
            perms: [Characteristic.Perms.READ, Characteristic.Perms.WRITE, Characteristic.Perms.NOTIFY]
        });

        this.value = this.getDefaultValue();
    };
    inherits(ColorTemperature, Characteristic);

    ColorTemperature.UUID = UUID_COLOR_TEMPERATURE;

    homebridge.registerPlatform("homebridge-lifx-lan", "LifxLan", LifxLanPlatform, true);
};

function LifxLanPlatform(log, config, api) {
    if (!config) {
        log.warn("Ignoring LIFX Platform setup because it is not configured");
        this.disabled = true;
        return;
    }

    this.config = config;

    fadeDuration = this.config.duration || 1000;

    if (this.config.ignoredDevices && this.config.ignoredDevices.constructor !== Array) {
        delete this.config.ignoredDevices;
    }

    this.ignoredDevices = this.config.ignoredDevices || [];

    this.api = api;
    this.accessories = {};
    this.log = log;

    Client.on('light-offline', function(bulb) {
        var uuid = UUIDGen.generate(bulb.id);
        var object = this.accessories[uuid];

        if (object !== undefined) {
            if (object instanceof LifxAccessory) {
                this.log("Offline: %s [%s]", object.accessory.context.name, bulb.id);
                object.updateReachability(bulb, false);
            }
        }
    }.bind(this));

    Client.on('light-online', function(bulb) {
        var uuid = UUIDGen.generate(bulb.id);
        var object = this.accessories[uuid];

        if (object === undefined) {
            this.addAccessory(bulb);
        }
        else {
            if (object instanceof LifxAccessory) {
                this.log("Online: %s [%s]", object.accessory.context.name, bulb.id);
                object.updateReachability(bulb, true);
            }
        }
    }.bind(this));

    Client.on('light-new', function(bulb) {
        var uuid = UUIDGen.generate(bulb.id);
        var accessory = this.accessories[uuid];

        if (this.ignoredDevices.indexOf(bulb.id) !== -1) {
            if (accessory !== undefined) {
                this.removeAccessory(accessory);
            }

            return;
        }
        else if (accessory === undefined) {
            this.addAccessory(bulb);
        }
        else {
            bulb.getState(function(err, state) {
                if (err) {
                    state = {
                        label: bulb.client.label
                    }
                }

                this.log("Online: %s [%s]", accessory.context.name, bulb.id);
                this.accessories[uuid] = new LifxAccessory(this.log, accessory, bulb, state);
            }.bind(this));
        }
    }.bind(this));

    this.api.on('didFinishLaunching', function() {
        Client.init({
            debug:                  this.config.debug || false,
            broadcast:              this.config.broadcast || '255.255.255.255',
            lightOfflineTolerance:  this.config.lightOfflineTolerance || 2,
            messageHandlerTimeout:  this.config.messageHandlerTimeout || 2500,
            resendMaxTimes:         this.config.resendMaxTimes || 3,
            resendPacketDelay:      this.config.resendPacketDelay || 500,
            address:                this.config.address || '0.0.0.0'
        });
    }.bind(this));
}

LifxLanPlatform.prototype.addAccessory = function(bulb, data) {
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
                accessory.context.features = data.productFeatures || { color: false, infrared: false, multizone: false };

                accessory.getService(Service.AccessoryInformation)
                    .setCharacteristic(Characteristic.Manufacturer, accessory.context.make)
                    .setCharacteristic(Characteristic.Model, accessory.context.model)
                    .setCharacteristic(Characteristic.SerialNumber, bulb.id);

                this.log("Found: %s [%s]", accessory.context.name, bulb.id);

                var service = accessory.addService(Service.Lightbulb, accessory.context.name);

                service.addCharacteristic(Characteristic.Brightness);
                service.addCharacteristic(ColorTemperature);

                if (accessory.context.features.color === true) {
                    service.addCharacteristic(Characteristic.Hue);
                    service.addCharacteristic(Characteristic.Saturation);
                }

                this.accessories[accessory.UUID] = new LifxAccessory(this.log, accessory, bulb, data);

                this.api.registerPlatformAccessories("homebridge-lifx-lan", "LifxLan", [accessory]);
            }.bind(this));
    }.bind(this));
}

LifxLanPlatform.prototype.configureAccessory = function(accessory) {
    accessory.updateReachability(false);
    this.accessories[accessory.UUID] = accessory;
}

LifxLanPlatform.prototype.configurationRequestHandler = function(context, request, callback) {
    var respDict = {};

    if (request && request.type === "Terminate") {
        context.onScreen = null;
    }

    var sortAccessories = function() {
        context.sortedAccessories = Object.keys(this.accessories).map(
            function(k){return this[k] instanceof PlatformAccessory ? this[k] : this[k].accessory},
            this.accessories
        ).sort(function(a,b) {if (a.context.name < b.context.name) return -1; if (a.context.name > b.context.name) return 1; return 0});

        return Object.keys(context.sortedAccessories).map(function(k) {return this[k].context.name}, context.sortedAccessories);
    }.bind(this);

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
            context.canAddService = [];
            context.canRemoveService = [];
            context.onScreenSelection = [];

            var service = context.accessory.getService(Service.Lightbulb);
            var characteristics, services;

            if (!/(650|Original)/.test(context.accessory.context.model)) {
                services = [Service.LightSensor];
            }

            if (context.accessory.context.features.color === true) {
                characteristics = [Characteristic.Brightness, ColorTemperature, Characteristic.Hue, Characteristic.Saturation];
            }
            else {
                characteristics = [Characteristic.Brightness, ColorTemperature];
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

            for (var index in services) {
                if (context.accessory.getService(services[index]) !== undefined) {
                    context.canRemoveService.push(services[index]);
                }
                else {
                    context.canAddService.push(services[index]);
                }
            }

            var items = [];

            if (context.canAddCharacteristic.length > 0) {
                items.push("Add Characteristic");
                context.onScreenSelection.push({action: 'add', item: 'characteristic', screen: 'AddCharacteristic'});
            }

            if (context.canAddService.length > 0) {
                items.push("Add Service");
                context.onScreenSelection.push({action: 'add', item: 'service', screen: 'AddService'});
            }

            if (context.canRemoveCharacteristic.length > 0) {
                items.push("Remove Characteristic");
                context.onScreenSelection.push({action: 'remove', item: 'characteristic', screen: 'RemoveCharacteristic'});
            }

            if (context.canRemoveService.length > 0) {
                items.push("Remove Service");
                context.onScreenSelection.push({action: 'remove', item: 'service', screen: 'RemoveService'});
            }

            respDict = {
                "type": "Interface",
                "interface": "list",
                "title": "Select action for " + context.accessory.context.name,
                "allowMultipleSelection": false,
                "items": items
            }

            context.onScreen = "ModifyAccessory";

            callback(respDict);
            break;
        case "ModifyAccessory":
            var selection = context.onScreenSelection[request.response.selections[0]];

            context.onScreen = selection.screen;

            var items = [];

            for (var index in context["can" + context.onScreen]) {
                if (selection.item === 'service') {
                    var name;

                    switch(context["can" + context.onScreen][index].UUID) {
                        case Service.LightSensor.UUID:
                            name = "LightSensor";
                            break;
                    }

                    items.push(name);
                    continue;
                }

                var characteristic = new (Function.prototype.bind.apply(context["can" + context.onScreen][index], arguments));
                items.push(characteristic.displayName);
            }

            respDict = {
                "type": "Interface",
                "interface": "list",
                "title": "Select " + selection.item + " to " + selection.action,
                "allowMultipleSelection": true,
                "items": items
            }

            callback(respDict);
            break;
        case "AddCharacteristic":
        case "AddService":
        case "RemoveCharacteristic":
        case "RemoveService":
            if (request.response.selections) {
                var service = context.accessory.getService(Service.Lightbulb);

                for (var i in request.response.selections.sort()) {
                    var item = context["can" + context.onScreen][request.response.selections[i]];

                    switch(context.onScreen) {
                        case "AddCharacteristic":
                            var characteristic = service.getCharacteristic(item);

                            if (characteristic == null) {
                                service.addCharacteristic(item);
                            }

                            if (this.accessories[context.accessory.UUID] instanceof LifxAccessory) {
                                this.accessories[context.accessory.UUID].addEventHandler(service, item);
                            }

                            break;
                        case "AddService":
                            if (context.accessory.getService(item) === undefined) {
                                context.accessory.addService(item, context.accessory.context.name);

                                this.accessories[context.accessory.UUID].addEventHandler(Service.LightSensor, Characteristic.CurrentAmbientLightLevel);
                            }

                            break;
                        case "RemoveCharacteristic":
                            var characteristic = service.getCharacteristic(item);

                            characteristic.removeAllListeners();
                            service.removeCharacteristic(characteristic);

                            break;
                        case "RemoveService":
                            if (context.accessory.getService(item) !== undefined) {
                                context.accessory.removeService(context.accessory.getService(item));
                            }
                    }
                }

                respDict = {
                    "type": "Interface",
                    "interface": "instruction",
                    "title": "Finished",
                    "detail": "Accessory " + (/Service$/.test(context.onScreen) ? "service" : "characteristic") + " " + (/^Remove/.test(context.onScreen) ? "removal" : "addition") + " was successful."
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
            switch(request.response.selections[0]) {
                case 0:
                    context.onScreen = "Modify";
                    break;
                case 1:
                    context.onScreen = "Remove";
                    break;
                case 2:
                    //context.onScreen = "IgnoreList";
                    context.onScreen = "Configuration";
                    break;
            }
        case "Modify":
        case "Remove":
            if (context.onScreen != "Configuration") {
                respDict = {
                    "type": "Interface",
                    "interface": "list",
                    "title": "Select accessory to " + context.onScreen.toLowerCase(),
                    "allowMultipleSelection": context.onScreen == "Remove",
                    "items": sortAccessories()
                }

                context.onScreen = "Do" + context.onScreen;
            }
            else {
                respDict = {
                    "type": "Interface",
                    "interface": "list",
                    "title": "Select Option",
                    "allowMultipleSelection": false,
                    "items": ["Ignored Devices"]
                }

                /*
                respDict = {
                    "type": "Interface",
                    "interface": "list",
                    "title": "Modify Ignore List",
                    "allowMultipleSelection": false,
                    "items": this.ignoredDevices.length > 0 ? ["Add Accessory", "Remove Accessory"] : ["Add Accessory"]
                }
                */
            }

            callback(respDict);
            break;
        case "Configuration":
            respDict = {
                "type": "Interface",
                "interface": "list",
                "title": "Modify Ignored Devices",
                "allowMultipleSelection": false,
                "items": this.ignoredDevices.length > 0 ? ["Add Accessory", "Remove Accessory"] : ["Add Accessory"]
            }

            callback(respDict);
            break;
        case "IgnoreList":
            context.onScreen = request && request.response && request.response.selections[0] == 1 ? "IgnoreListRemove" : "IgnoreListAdd";

            if (context.onScreen == "IgnoreListAdd") {
                respDict = {
                    "type": "Interface",
                    "interface": "list",
                    "title": "Select accessory to add to Ignored Devices",
                    "allowMultipleSelection": true,
                    "items": sortAccessories()
                }
            }
            else {
                context.selection = JSON.parse(JSON.stringify(this.ignoredDevices));

                respDict = {
                    "type": "Interface",
                    "interface": "list",
                    "title": "Select accessory to remove from Ignored Devices",
                    "allowMultipleSelection": true,
                    "items": context.selection
                }
            }

            callback(respDict);
            break;
        case "IgnoreListAdd":
            if (request.response.selections) {
                for (var i in request.response.selections.sort()) {
                    var accessory = context.sortedAccessories[request.response.selections[i]];

                    if (accessory.context && accessory.context.id && this.ignoredDevices.indexOf(accessory.context.id) == -1) {
                        this.ignoredDevices.push(accessory.context.id);
                    }

                    this.removeAccessory(accessory);
                }

                this.config.ignoredDevices = this.ignoredDevices;

                respDict = {
                    "type": "Interface",
                    "interface": "instruction",
                    "title": "Finished",
                    "detail": "Ignore List update was successful."
                }
            }

            context.onScreen = null;
            callback(respDict, "platform", true, this.config);
            break;

        case "IgnoreListRemove":
            if (request.response.selections) {
                for (var i in request.response.selections) {
                    var id = context.selection[request.response.selections[i]];

                    if (this.ignoredDevices.indexOf(id) != -1) {
                        this.ignoredDevices.splice(this.ignoredDevices.indexOf(id), 1);
                    }
                }
            }

            this.config.ignoredDevices = this.ignoredDevices;

            if (this.config.ignoredDevices.length === 0) {
                delete this.config.ignoredDevices;
            }

            context.onScreen = null;
            callback(respDict, "platform", true, this.config);
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
                    "items": ["Modify Accessory", "Remove Accessory", "Configuration"]
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
    this.accessory = accessory;
    this.power = data.power || 0;
    this.color = data.color || {hue: 0, saturation: 0, brightness: 50, kelvin: 2500};
    this.log = log;
    this.callbackStack = [];

    if (!this.accessory instanceof PlatformAccessory) {
        this.log("ERROR \n", this);
        return;
    }

    this.lastCalled = null;

    if (this.accessory.context.id === undefined) {
        this.accessory.context.id = bulb.id;
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

    if (service.testCharacteristic(Characteristic.CurrentAmbientLightLevel)) {
        service.removeCharacteristic(service.getCharacteristic(Characteristic.CurrentAmbientLightLevel));
    }

    if (service.testCharacteristic(Kelvin)) {
        service.removeCharacteristic(service.getCharacteristic(Kelvin));
        service.addCharacteristic(ColorTemperature);
    }

    this.accessory.on('identify', function(paired, callback) {
        this.log("%s - identify", this.accessory.context.name);
        callback();
    }.bind(this));

    this.addEventHandlers();
    this.updateReachability(bulb, true);
}

LifxAccessory.prototype.addEventHandler = function(service, characteristic) {
    if (!(service instanceof Service)) {
        service = this.accessory.getService(service);
    }

    if (service === undefined) {
        return;
    }

    if (service.testCharacteristic(characteristic) === false) {
        return;
    }

    switch(characteristic) {
        case Characteristic.On:
            service
                .getCharacteristic(Characteristic.On)
                .setValue(this.power > 0)
                .on('get', this.getPower.bind(this))
                .on('set', this.setPower.bind(this));
            break;
        case Characteristic.Brightness:
            service
                .getCharacteristic(Characteristic.Brightness)
                .setValue(this.color.brightness)
                .setProps({minValue: 1})
                .on('set', this.setBrightness.bind(this));
            break;
        case ColorTemperature:
            service
                .getCharacteristic(ColorTemperature)
                .setValue(this.miredConversion(this.color.kelvin))
                .on('set', this.setKelvin.bind(this));
            break;
        case Characteristic.CurrentAmbientLightLevel:
            service
                .getCharacteristic(Characteristic.CurrentAmbientLightLevel)
                .on('get', this.getAmbientLight.bind(this));
            break;
        case Characteristic.Hue:
            service
                .getCharacteristic(Characteristic.Hue)
                .setValue(this.color.hue)
                .on('set', this.setHue.bind(this));
            break;
        case Characteristic.Saturation:
            service
                .getCharacteristic(Characteristic.Saturation)
                .setValue(this.color.saturation)
                .on('set', this.setSaturation.bind(this));
            break;
    }
}

LifxAccessory.prototype.addEventHandlers = function() {
    this.addEventHandler(Service.Lightbulb, Characteristic.On);
    this.addEventHandler(Service.Lightbulb,Characteristic.Brightness);
    this.addEventHandler(Service.LightSensor, Characteristic.CurrentAmbientLightLevel);
    this.addEventHandler(Service.Lightbulb, ColorTemperature);

    this.addEventHandler(Service.Lightbulb, Characteristic.Hue);
    this.addEventHandler(Service.Lightbulb, Characteristic.Saturation);
}

LifxAccessory.prototype.closeCallbacks = function(err, value) {
    value = value || 0;

    while (this.callbackStack.length > 0) {
        this.callbackStack.pop()(err, value);
    }
}

LifxAccessory.prototype.get = function (type) {
    var state;

    switch(type) {
        case "brightness":
        case "hue":
        case "saturation":
            this.log("%s - Get %s: %d", this.accessory.context.name, type, this.color[type]);
            state = this.color[type];
            break;
        case "kelvin":
            this.log("%s - Get %s: %d", this.accessory.context.name, type, this.color[type]);
            state = this.miredConversion(this.color[type]);
            break;
        case "power":
            this.log("%s - Get power: %d", this.accessory.context.name, this.power);
            state = this.power > 0;
            break;
    }

    return state;
}

LifxAccessory.prototype.getAmbientLight = function(callback) {
    this.bulb.getAmbientLight(function(err, data) {
        var lux;

        if (data) {
            lux = parseInt(data * 1000) / 1000;
        }

        this.log("%s - Get ambient light: %d", this.accessory.context.name, lux);
        callback(null, lux);
    }.bind(this));
}

LifxAccessory.prototype.getPower = function(callback) {
    this.getState("power", callback);
}

LifxAccessory.prototype.getState = function(type, callback) {
    if (!this.accessory.reachable) {
        callback('Bulb not reachable');
        return;
    }

    if (this.lastCalled && (Date.now() - this.lastCalled) < 5000) {
        callback(null, this.get(type));
        return;
    }

    this.lastCalled = Date.now();

    this.callbackStack.push(callback);

    this.bulb.getState(function(err, data) {
        if (data) {
            this.power = data.power;
            this.color = data.color;
            this.accessory.updateReachability(true);

            var service = this.accessory.getService(Service.Lightbulb);

            if (service.testCharacteristic(Characteristic.Brightness)) {
                service.getCharacteristic(Characteristic.Brightness).updateValue(this.color.brightness);
            }

            if (service.testCharacteristic(ColorTemperature)) {
                service.getCharacteristic(ColorTemperature).updateValue(this.miredConversion(this.color.kelvin));
            }

            if (service.testCharacteristic(Characteristic.Hue)) {
                service.getCharacteristic(Characteristic.Hue).updateValue(this.color.hue);
            }

            if (service.testCharacteristic(Characteristic.Saturation)) {
                service.getCharacteristic(Characteristic.Saturation).updateValue(this.color.saturation);
            }
        }

        this.closeCallbacks(null, this.get(type));
    }.bind(this));
}

LifxAccessory.prototype.setBrightness = function(value, callback) {
    if (value == this.accessory.getService(Service.Lightbulb).getCharacteristic(Characteristic.Brightness).value) {
        callback(null);
        return;
    }

    this.setColor("brightness", value, callback);
}

LifxAccessory.prototype.setColor = function(type, value, callback){
    var kelvin;

    if (type === 'kelvin') {
        kelvin = this.miredConversion(value);
        this.log("%s - Set %s: %dK [%d mired]", this.accessory.context.name, type, kelvin, value);
        value = kelvin;
    }
    else {
        this.log("%s - Set %s: %d", this.accessory.context.name, type, value);
    }

    this.color[type] = value;

    this.bulb.color(this.color.hue, this.color.saturation, this.color.brightness, this.color.kelvin, fadeDuration, function (err) {
        callback(null);
    });
}

LifxAccessory.prototype.miredConversion = function(value) {
    return parseInt(1000000/value);
}

LifxAccessory.prototype.setHue = function(value, callback) {
    if (value == this.accessory.getService(Service.Lightbulb).getCharacteristic(Characteristic.Hue).value) {
        callback(null);
        return;
    }

    this.setColor("hue", value, callback);
}

LifxAccessory.prototype.setKelvin = function(value, callback) {
    if (value == this.accessory.getService(Service.Lightbulb).getCharacteristic(ColorTemperature).value) {
        callback(null);
        return;
    }

    this.setColor("kelvin", value, callback);
}

LifxAccessory.prototype.setSaturation = function(value, callback) {
    if (value == this.accessory.getService(Service.Lightbulb).getCharacteristic(Characteristic.Saturation).value) {
        callback(null);
        return;
    }

    this.setColor("saturation", value, callback);
}

LifxAccessory.prototype.setPower = function(state, callback) {
    this.log("%s - Set power: %d", this.accessory.context.name, state);

    this.bulb[state ? "on" : "off"](fadeDuration, function(err) {
        if (!err) {
            this.power = state;
        }

        callback(null);
    }.bind(this));
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
    this.bulb.getFirmwareVersion(function(err, data) {
        if (err) {
            return;
        }

        var service = this.accessory.getService(Service.AccessoryInformation);

        if (service.testCharacteristic(Characteristic.FirmwareRevision) === false) {
            service.addCharacteristic(Characteristic.FirmwareRevision);
        }

        service.setCharacteristic(Characteristic.FirmwareRevision, data.majorVersion + "." + data.minorVersion);
    }.bind(this));

    var model = this.accessory.getService(Service.AccessoryInformation).getCharacteristic(Characteristic.Model).value;

    if (model !== "Unknown" && model !== "Default-Model" && this.accessory.context.features !== undefined) {
        var service = this.accessory.getService(Service.Lightbulb);

        if (this.accessory.context.features.color === false && service.testCharacteristic(ColorTemperature) === true) {
            service.getCharacteristic(ColorTemperature).setProps({
                maxValue: 370,
                minValue: 154
            });
        }
        return;
    }

    this.bulb.getHardwareVersion(function(err, data) {
        if (err) {
            data = {}
        }

        this.accessory.context.make = data.vendorName || "LIFX";
        this.accessory.context.model = data.productName || "Unknown";
        this.accessory.context.features = data.productFeatures || { color: false, infrared: false, multizone: false };

        this.accessory.getService(Service.AccessoryInformation)
            .setCharacteristic(Characteristic.Manufacturer, this.accessory.context.make)
            .setCharacteristic(Characteristic.Model, this.accessory.context.model)
            .setCharacteristic(Characteristic.SerialNumber, this.bulb.id);

        var service = this.accessory.getService(Service.Lightbulb);

        if (this.accessory.context.features.color === true) {
            if (service.testCharacteristic(Characteristic.Hue) === false) {
                service.addCharacteristic(Characteristic.Hue);
                this.addEventHandler(service, Characteristic.Hue);
            }

            if (service.testCharacteristic(Characteristic.Saturation) === false) {
                service.addCharacteristic(Characteristic.Saturation);
                this.addEventHandler(service, Characteristic.Saturation);
            }
        }
        else if (service.testCharacteristic(ColorTemperature) === true) {
            service.getCharacteristic(ColorTemperature).setProps({
                maxValue: 370,
                minValue: 154
            });
        }
    }.bind(this));
}

LifxAccessory.prototype.updateReachability = function(bulb, reachable) {

    this.accessory.updateReachability(reachable);
    this.bulb = bulb;

    if (!reachable) {
        this.closeCallbacks('LIFX light went offline.');
    }

    if (reachable === true) {
        this.updateInfo();
    }
}