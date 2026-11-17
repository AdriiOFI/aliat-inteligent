# Specify the Travel Mode

Configure the `travelMode` parameter in your Routes API request to compute
routes tailored to specific modes of transportation, such as driving, public
transit, walking, bicycling, or motorized two-wheeled vehicles.

## Prerequisites

*   An active Google Cloud project with the **Routes API** enabled.
*   A valid API key with permissions to call the Routes API.
*   A base routing request (`computeRoutes` or `computeRouteMatrix`).

## Supported Travel Modes

Set the `travelMode` field in the JSON request body using one of the following
[`RouteTravelMode`](https://developers.google.com/maps/documentation/routes/reference/rest/v2/RouteTravelMode)
enum values:

`travelMode` Value | Vehicle / Mode Type     | Description & Constraints
:----------------- | :---------------------- | :------------------------
`DRIVE`            | Passenger car (Default) | Computes a standard driving route. If `travelMode` is omitted, the API defaults to `DRIVE` (gasoline-powered car).
`TRANSIT`          | Public transportation   | Computes a route using available public transit options (buses, subways, trains, etc.), including walking instructions to, from, and between stations. **Note:** `TRANSIT` does not support intermediate waypoints or `routingPreference: "TRAFFIC_AWARE"`.
`WALK`             | Pedestrian              | Computes a walking route. **Beta Notice Required** (see below). **Note:** Does not support `routingPreference`.
`BICYCLE`          | Human-powered bicycle   | Computes a bicycling route. **Beta Notice Required** (see below). **Note:** Does not support `routingPreference`.
`TWO_WHEELER`      | Motorized two-wheeler   | Computes a route tailored for motorcycles and motorized scooters (distinct from human-powered bicycles). **Beta Notice Required** (see below).

> **Mandatory Beta Warning:** Walking (`WALK`), bicycling (`BICYCLE`), and
> two-wheel (`TWO_WHEELER`) routes are in beta and might sometimes be missing
> clear sidewalks, pedestrian paths, or bicycling paths. **You must display this
> warning to the user** for all walking, bicycling, and two-wheel routes that
> you display in your application.

--------------------------------------------------------------------------------

## Implementation Examples

### 1. Driving or Two-Wheeled Route (`DRIVE` / `TWO_WHEELER`)

Motorized vehicle modes (`DRIVE` and `TWO_WHEELER`) support traffic-aware
routing (`routingPreference`).

```bash
curl -X POST 'https://routes.googleapis.com/directions/v2:computeRoutes' \
  -H 'Content-Type: application/json' \
  -H 'X-Goog-Api-Key: YOUR_API_KEY' \
  -H 'X-Goog-FieldMask: routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline' \
  -H 'X-Goog-Maps-Solution-ID: gmp_git_agentskills_v1' \
  -d '{
    "origin": {
      "address": "1600 Amphitheatre Parkway, Mountain View, CA"
    },
    "destination": {
      "address": "1 Telegraph Hill Blvd, San Francisco, CA"
    },
    "travelMode": "TWO_WHEELER",
    "routingPreference": "TRAFFIC_AWARE"
  }'
```

### 2. Public Transit Route (`TRANSIT`)

When using `TRANSIT`, omit `routingPreference` (traffic-aware routing only
applies to motorized road vehicles) and include transit-specific fields in your
`X-Goog-FieldMask` if you need step-by-step transit details.

```bash
curl -X POST 'https://routes.googleapis.com/directions/v2:computeRoutes' \
  -H 'Content-Type: application/json' \
  -H 'X-Goog-Api-Key: YOUR_API_KEY' \
  -H 'X-Goog-FieldMask: routes.duration,routes.distanceMeters,routes.legs.steps.transitDetails' \
  -H 'X-Goog-Maps-Solution-ID: gmp_git_agentskills_v1' \
  -d '{
    "origin": {
      "address": "Grand Central Terminal, New York, NY"
    },
    "destination": {
      "address": "Empire State Building, New York, NY"
    },
    "travelMode": "TRANSIT",
    "transitPreferences": {
      "routingPreference": "LESS_WALKING",
      "allowedTravelModes": ["SUBWAY", "BUS"]
    }
  }'
```

### 3. Walking or Bicycling Route (`WALK` / `BICYCLE`)

When requesting `WALK` or `BICYCLE` routes, you **must not** include
`routingPreference` in the request body, as traffic calculations are invalid for
non-motorized modes and will result in a `400 Bad Request` error.

```bash
curl -X POST 'https://routes.googleapis.com/directions/v2:computeRoutes' \
  -H 'Content-Type: application/json' \
  -H 'X-Goog-Api-Key: YOUR_API_KEY' \
  -H 'X-Goog-FieldMask: routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline' \
  -H 'X-Goog-Maps-Solution-ID: gmp_git_agentskills_v1' \
  -d '{
    "origin": {
      "location": {
        "latLng": {
          "latitude": 37.7749,
          "longitude": -122.4194
        }
      }
    },
    "destination": {
      "location": {
        "latLng": {
          "latitude": 37.7955,
          "longitude": -122.3937
        }
      }
    },
    "travelMode": "BICYCLE"
  }'
```

--------------------------------------------------------------------------------

## Common Pitfalls & Troubleshooting

*   **`400 INVALID_ARGUMENT` when using `WALK`, `BICYCLE`, or `TRANSIT`:**
    Ensure that top-level `routingPreference` (e.g., `TRAFFIC_AWARE` or
    `TRAFFIC_AWARE_OPTIMAL`) is removed from the request payload. Only `DRIVE`
    and `TWO_WHEELER` support traffic routing preferences. For `TRANSIT`, use
    `transitPreferences.routingPreference` (`LESS_WALKING` or `FEWER_TRANSFERS`)
    instead.
*   **Confusing `BICYCLE` and `TWO_WHEELER`:** Use `BICYCLE` for human-powered
    bicycles (which utilizes bike lanes and trails) and `TWO_WHEELER` for
    motorcycles/motorized scooters (which uses roadways and supports
    `routeModifiers` like `avoidHighways` and `avoidTolls`).
