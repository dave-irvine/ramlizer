# ramlizer

It's a strategizer for RAML.

## What?

More specifically it's an API mock service that supports the use of strategies, and allows configuration of the mocking service to follow specific strategies. For multiple RAML files.

## Why?

Let's say you've got an API service with an endpoint. You've got some UI that displays differently depending on the response from that endpoint.

If your endpoint only behaves different due to backend changes, you don't have an easy way to trigger this from your UI, so how do you check your different UI states?

ramlizer solves this problem by letting you configure how a mock endpoint behaves, while the endpoint is still running. No stopping, changing conditions and restarting, it's all live and real-time.

## How?

ramlizer runs its own API alongside your mocked API (hopefully you don't have a `/ramlizer` endpoint!). Call this API to configure how your mocked API responds.

The POST endpoint takes four parameters in a JSON payload:

- route (The endpoint route to affect)
- method (The http method to affect)
- [nextResponseCode] (The next response code the endpoint should produce)
- [nextExampleName] (The next named example the endpoint should use)

Usually RAML endpoints only have one example, so how to define multiple ones?

#### Multiple RAML examples

We use an undocumented RAML feature to let you specify multiple named examples for your endpoints, and then you select which example to run for the next call to the endpoint.

Here's an example of examples:

```raml
/login:
  post:
    responses:
      400:
        body:
          properties:
            errorList:
              type: object
              properties:
                fieldName:
                  type: string
                  example: 'field'
          examples:
            badUsername:
              errorList:
                -
                  fieldName: username
            badPassword:
              errorList:
                -
                  fieldName: password
```

And here's the JSON payload sent to ramlizer to select one of those examples:

```json
{
  "route": "/login",
  "method": "post",
  "nextResponseCode": "400",
  "nextExampleName": "badPassword"
}
```

And here's the JSON response when you call the `/login` endpoint:

```json
{
  "errorList": [
    {
      "fieldName": "password"
    }
  ]
}
```

#### Multiple RAML files

If you add multiple files to the target RAML folder, Ramlizer will process them all and create multiple end-points from your files.

#### Script options

_--folder_

This option sets the destination folder where the Ramlizer script will look for RAML files.

_--port_

This option sets the port Ramlizer will use. By default this is '8080'.

_--endpoint_

This option sets the endpoint Ramlizer will use for its endpoint. By default this is 'ramlizer'.
