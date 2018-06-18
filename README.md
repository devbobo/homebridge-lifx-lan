# homebridge-lifx-lan

[![npm package](https://nodei.co/npm/homebridge-lifx-lan.png?downloads=true&downloadRank=true&stars=true)](https://nodei.co/npm/homebridge-lifx-lan/)

[![donate](https://img.shields.io/badge/%24-Buy%20me%20a%20coffee-ff69b4.svg)](https://www.buymeacoffee.com/devbobo)
[![Slack Channel](https://img.shields.io/badge/slack-homebridge--lifx-e01563.svg)](https://homebridgeteam.slack.com/messages/C1NE2GM0S/)

LiFx LAN platform plugin for [Homebridge](https://github.com/nfarina/homebridge).

This platform uses only the LiFx LAN protocol.

Currently supports:
- On/Off
- Brightness
- Kelvin
- Hue (Color models only)
- Saturation (Color models only)

# Installation

1. Install homebridge using: npm install -g homebridge
2. Install this plugin using: npm install -g homebridge-lifx-lan
3. Update your configuration file. See the sample below.

# Updating

- npm update -g homebridge-lifx-lan

# Configuration

Configuration sample:

 ```javascript
"platforms": [
    {
        "platform": "LifxLan",
        "name": "LiFx",
        "ignoredDevices" : ["abcd1234561", "efabcd6721"]
    }
]

```


# Credits

- Marius Rumpf for his awesome [node-lifx](https://github.com/MariusRumpf/node-lifx) library
