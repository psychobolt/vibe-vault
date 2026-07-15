// Lightweight GPX/TCX route parser shared by both tools.
(function (global) {
"use strict";

async function parseActivityFile(file) {
  const extension = file.name.split(".").pop().toLowerCase();
  if (!new Set(["gpx", "tcx"]).has(extension)) throw new Error("Activity Route accepts GPX or TCX files only.");
  const xml = new DOMParser().parseFromString(await file.text(), "application/xml");
  if (xml.querySelector("parsererror")) throw new Error("The activity file contains invalid XML.");
  const points = extension === "gpx" ? readGpx(xml) : readTcx(xml);
  if (points.length < 2) throw new Error("The activity file does not contain enough timed route points.");
  return summarize(points, file.name);
}

function readGpx(xml) {
  return [...xml.querySelectorAll("trkpt")].map((point) => ({
    lat: Number(point.getAttribute("lat")), lon: Number(point.getAttribute("lon")),
    elevation: Number(point.querySelector("ele")?.textContent),
    time: Date.parse(point.querySelector("time")?.textContent || ""),
  })).filter(validPoint);
}

function readTcx(xml) {
  return [...xml.querySelectorAll("Trackpoint")].map((point) => ({
    lat: Number(point.querySelector("LatitudeDegrees")?.textContent),
    lon: Number(point.querySelector("LongitudeDegrees")?.textContent),
    elevation: Number(point.querySelector("AltitudeMeters")?.textContent),
    time: Date.parse(point.querySelector("Time")?.textContent || ""),
  })).filter(validPoint);
}

function validPoint(point) {
  return Number.isFinite(point.lat) && Number.isFinite(point.lon) && Number.isFinite(point.elevation) && Number.isFinite(point.time);
}

function summarize(points, fileName) {
  let distanceM = 0, elevationGainM = 0, movingSeconds = 0, climbingSeconds = 0, declineSeconds = 0;
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1], current = points[index];
    const seconds = (current.time - previous.time) / 1000;
    const segmentM = haversine(previous, current);
    if (seconds <= 0 || seconds > 300 || segmentM < 1) continue;
    const elevationChange = current.elevation - previous.elevation;
    const grade = elevationChange / segmentM * 100;
    distanceM += segmentM;
    movingSeconds += seconds;
    if (elevationChange > 0) elevationGainM += elevationChange;
    if (grade >= 2) climbingSeconds += seconds;
    if (grade <= -2) declineSeconds += seconds;
  }
  if (!movingSeconds || !distanceM) throw new Error("No usable moving segments were found in the activity file.");
  return {
    activityFileName: fileName,
    distanceKm: distanceM / 1000,
    elevationGainM,
    movingDurationMinutes: roundMinutes(movingSeconds / 60),
    stoppedDurationMinutes: 0,
    climbingDurationMinutes: roundMinutes(climbingSeconds / 60),
    declineDurationMinutes: roundMinutes(declineSeconds / 60),
  };
}

function roundMinutes(minutes) { return Math.round(minutes * 10) / 10; }

function haversine(a, b) {
  const radius = 6371000, radians = (degrees) => degrees * Math.PI / 180;
  const dLat = radians(b.lat - a.lat), dLon = radians(b.lon - a.lon);
  const value = Math.sin(dLat / 2) ** 2 + Math.cos(radians(a.lat)) * Math.cos(radians(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * radius * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

global.VeloActivity = { parseActivityFile };
})(globalThis);
