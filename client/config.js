"use strict";

export default {
  pageSize: 10,
  filter: [
    {
      label: "Serial number",
      parameter: "DeviceID.SerialNumber",
      type: "string"
    },
    {
      label: "Product class",
      parameter: "DeviceID.ProductClass",
      type: "string"
    },
    {
      label: "Tag",
      parameter: "tag",
      type: "string"
    }
  ],
  index: [
    {
      label: "Serial number",
      parameter: "DeviceID.SerialNumber"
    },
    {
      label: "Product class",
      parameter: "DeviceID.ProductClass"
    },
    {
      label: "Software version",
      parameter: "InternetGatewayDevice.DeviceInfo.SoftwareVersion"
    },
    {
      label: "MAC",
      parameter:
        "InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANIPConnection.1.MACAddress"
    }
  ]
};
