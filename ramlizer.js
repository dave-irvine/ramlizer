#!/usr/bin/env node
const argv = require("yargs")
  .option("folder", {
    alias: "f",
    describe: "path to the raml files to mock",
    requiresArg: true,
    type: "string"
  })
  .demandOption("folder").argv;

const _ = require("lodash");
const ora = require("ora");

const spinner = ora("Launching").start();

const http = require("http");
const ramlParser = require("raml-1-parser");
const osprey = require("osprey");
const resources = require("osprey-resources");
const finalhandler = require("finalhandler");
const morgan = require("morgan");
const bodyParser = require("body-parser");
const Negotiator = require("negotiator");

spinner.succeed();
spinner.start("Loading RAML");

const plannedMethodResponseCodes = {};
const plannedMethodExampleNames = {};

//Set up app
const app = osprey.Router();

function mockHandler(handledRoute) {
  return (req, res) => {
    const { method } = handledRoute;
    const negotiator = new Negotiator(req);
    const route = req.route.path;

    const plannedMethodResponseCode =
      plannedMethodResponseCodes[`${method}:${route}`];

    const plannedResponse = handledRoute.responses[plannedMethodResponseCode];

    const bodies = plannedResponse.body;
    const types = Object.keys(bodies);
    const type = negotiator.mediaType(types);
    const body = bodies[type];
    const properties = body.properties;

    const response = {};

    if (body.examples) {
      const plannedExampleName =
        plannedMethodExampleNames[`${method}:${route}`];

      let plannedExample = body.examples.find(example => {
        return example.name === plannedExampleName;
      });

      if (!plannedExample) {
        plannedExample = _.sample(body.examples);
      }

      Object.assign(response, plannedExample.structuredValue);
    } else {
      _.each(properties, property => {
        response[property.name] = "";

        if (property.enum) {
          response[property.name] = _.sample(property.enum);
        }
      });
    }

    res.statusCode = plannedResponse.code;
    res.write(JSON.stringify(response));
    res.end();
  };
}

function mockServer(raml) {
  return resources(raml.resources, mockHandler);
}

function scenarioConfigurator(req, res) {
  const { method, nextExampleName, nextResponseCode, route } = req.body;
  const response = {
    route
  };

  if (nextResponseCode) {
    const oldResponseCode =
      plannedMethodResponseCodes[`${method}:${route}`] || "none";
    plannedMethodResponseCodes[`${method}:${route}`] = nextResponseCode;

    response.nextResponseCode = nextResponseCode;
    response.oldResponseCode = oldResponseCode;
  }

  if (nextExampleName) {
    const oldExampleName =
      plannedMethodExampleNames[`${method}:${route}`] || "none";
    plannedMethodExampleNames[`${method}:${route}`] = nextExampleName;

    response.nextExampleName = nextExampleName;
    response.oldExampleName = oldExampleName;
  }

  res.statusCode = 200;

  res.write(JSON.stringify(response));

  res.end();
}

function fillStrategies(raml) {
  raml.resources.forEach(resource => {
    spinner.info(`Discovering strategies for: ${resource.relativeUri}`);
    resource.methods.forEach(resourceMethod => {
      spinner.info(
        `${resource.relativeUri} has method ${resourceMethod.method}`
      );

      if (!resourceMethod.responses) {
        spinner.warn(
          `${resource.relativeUri}:${
            resourceMethod.method
          } has no responses, skipping`
        );
        return;
      }

      _.each(resourceMethod.responses, methodResponse => {
        spinner.info(
          `${resource.relativeUri}:${resourceMethod.method} will produce a '${
            methodResponse.code
          }' response code`
        );

        const bodies = methodResponse.body;

        if (_.size(bodies) > 1) {
          spinner.warn(
            `${resource.relativeUri}:${
              resourceMethod.method
            } has multiple body types, picking the first`
          );
        }

        const body = bodies[Object.keys(bodies)[0]];

        if (!body.examples) {
          spinner.warn(
            `${resource.relativeUri}:${resourceMethod.method}:${
              methodResponse.code
            } has no examples, skipping`
          );
          return;
        }

        _.each(body.examples, example => {
          spinner.info(
            `${resource.relativeUri}:${resourceMethod.method}:${
              methodResponse.code
            } contains an example named '${example.name}'`
          );
        });
      });

      let selectedCode = "200";

      if (!resourceMethod.responses["200"]) {
        selectedCode = _.sample(resourceMethod.responses).code;
      }

      spinner.info(
        `The first call to ${resource.relativeUri}:${
          resourceMethod.method
        } will receive a '${selectedCode}' response`
      );

      plannedMethodResponseCodes[
        `${resourceMethod.method}:${resource.relativeUri}`
      ] = selectedCode;

      plannedMethodExampleNames[
        `${resourceMethod.method}:${resource.relativeUri}`
      ] = "default";
    });
  });
}

function startServer(argv) {
  const port = argv.port ? argv.port : 8080,
    endpoint = argv.endpoint ? argv.endpoint : "ramlizer";

  app.use(morgan("combined"));
  app.use(bodyParser.json());
  app.post("/" + endpoint, scenarioConfigurator);

  spinner.succeed();
  spinner.start(
    "Listening for configuration requests on http://localhost:" +
      port +
      "/" +
      endpoint
  );
}

function applyRAML(raml, file) {
  //Start servers
  spinner.succeed();
  spinner.start("Creating HTTP mock services for " + file);

  app.use(mockServer(raml));
  app.use(osprey.errorHandler());
}

function portListener(argv) {
  spinner.succeed();
  spinner.start("Launching HTTP server");
  const server = http.createServer((req, res) => {
      app(req, res, finalhandler(req, res));
    }),
    port = argv.port ? argv.port : 8080;

  server.listen(port, () => {
    spinner.succeed();
    spinner.info("Listening on http://localhost:" + port);
  });
}

function parseRAML(file) {
  //
  let raml = "";
  // Parse Raml based on file
  ramlParser
    .loadRAML(file, { rejectOnErrors: true })
    .then(ramlApi => {
      spinner.succeed();
      spinner.start("Parsing RAML");

      raml = ramlApi.expand(true).toJSON({
        serializeMetadata: false
      });

      spinner.succeed();
      spinner.start("Filling strategy queues");

      fillStrategies(raml);

      //Apply RAML strategies to server
      applyRAML(raml, file);
    })
    .catch(err => {
      console.log(err);
    });
}

const ramlFolder = String(argv.folder);
const fs = require("fs");

startServer(argv);

fs.readdir(argv.folder, function(err, files) {
  const ramlFiles = files.filter(el => /\.raml$/.test(el));

  ramlFiles.forEach(file => {
    parseRAML(ramlFolder + file);
  });

  setTimeout(function() {
    portListener(argv);
  }, 4000);
});
