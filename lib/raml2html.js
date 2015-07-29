#!/usr/bin/env node

'use strict';

var raml2obj = require('raml2obj');
var handlebars = require('handlebars');
var marked = require('marked');
var program = require('commander');
var fs = require('fs');
var pjson = require('../package.json');
var renderer = new marked.Renderer();

renderer.table = function(thead, tbody) {
    // Render Bootstrap tables
    return '<table class="table"><thead>' + thead + '</thead><tbody>' + tbody + '</tbody></table>';
};

function _markDownHelper(text) {
    if (text && text.length) {
        return new handlebars.SafeString(marked(text, { renderer: renderer }));
    } else {
        return '';
    }
}

function _markDownHelperFirstSentence(text) {
    if (text && text.length) {
	var re = /[^]*?[.?!]\s/gim;
	var para = new handlebars.SafeString(marked((text + " ").match(re).slice(0,1).join(''), { renderer: renderer })); 
	return new handlebars.SafeString(para.string.trim().replace(/<p>([^]*?)<\/p>/gim,"$1"));
    } else {
        return '';
    }
}

function _markDownHelperRest(text) {
    if (text && text.length) {
	var re = /[^]*?[.?!]\s/gim;

        return new handlebars.SafeString(marked((text + " ").match(re).slice(1).join(''), { renderer: renderer }));
    } else {
        return '';
    }
}

function _schemaUrlHelper(text) {
    var protocol = text.trim().substr(0,3);
    if( protocol == 'htt' || protocol == '../'){
        return new handlebars.SafeString('<a href="' + text.trim() + '">Schema</a>');
    }
}

function _lockIconHelper(securedBy) {
    if (securedBy && securedBy.length) {
        var index = securedBy.indexOf(null);
        if (index !== -1) {
            securedBy.splice(index, 1);
        }

        if (securedBy.length) {
            return new handlebars.SafeString(' <span class="glyphicon glyphicon-lock" title="Authentication required"></span>');
        }
    }

    return '';
}

// Handlebars is too dumb to support or/and in the templates
function _emptyRequestCheckHelper(uriParams, queryParams, headerParams, body, options) {
    if ( queryParams === undefined && headerParams === undefined && JSON.stringify(body) === undefined ) {
        return handlebars.SafeString('<!-- No request required -->');
    } else {
        return options.fn(this);
    }
}

function _emptyResourceCheckHelper(options) {
    if (this.methods || (this.description && this.parentUrl)) {
	    return options.fn(this);
    }
}

function _parsePath(templateParam) {
    if (templateParam) {
        if (program.template.indexOf('.') == 0) {
            return process.cwd() + '/' + templateParam;
        }
        return templateParam;
    }
}

function render(source, config, onSuccess, onError) {
    config = config || {};
    config.protocol = config.https ? 'https:' : 'http:';
    config.raml2HtmlVersion = pjson.version;

    // Register handlebar helpers
    for (var helperName in config.helpers) {
        if (config.helpers.hasOwnProperty(helperName)) {
            handlebars.registerHelper(helperName, config.helpers[helperName]);
        }
    }

    // Register handlebar partials
    for (var partialName in config.partials) {
        if (config.partials.hasOwnProperty(partialName)) {
            handlebars.registerPartial(partialName, config.partials[partialName]);
        }
    }

    raml2obj.parse(source, function(ramlObj) {

        // What order do we want our methods in?
        var order  = ['get','head','post','put','delete','trace','connect'];
        
        // Sorts the methods arrays by the order specified in the order array.
        function sortedObject(object){
            var sortedObj = {}, keys = Object.keys(object);
            
            // Look at each key and copy it over unless
            // we have the methods array on our hands
            for(var index in keys){
                var key = keys[index];
                // If it's the methods array, sort it.
                if(key == "methods"){
                    sortedObj[key] = object[key].sort( function(a,b){ return order.indexOf(a.method) - order.indexOf(b.method)} );
                } else if( typeof object[key] == 'object' && (!object[key] instanceof Array)) { // An object, recurse on it.
                    sortedObj[key] = sortedObject(object[key]);
                } else if( object[key] instanceof Array && typeof object[key][0] == 'object' ) { // An array of objects, recurse on each object. 
                    sortedObj[key] = object[key].map( function cb(currentValue, index, array){ return sortedObject(currentValue) }  );
                } else { // A normal field, copy it over.
                    sortedObj[key] = object[key];
                }          
            }               
            return sortedObj;
        }

        var ramlObj = sortedObject(ramlObj);

        ramlObj.config = config;
        var result = config.template(ramlObj);

        if (false &&  config.processOutput) {
            config.processOutput(result, onSuccess, onError)
        } else {
            onSuccess(result);
        }
    }, onError);
}

function getDefaultConfig(https, mainTemplate, resourceTemplate, itemTemplate) {
    return {
        'https': https,
        'template': require(mainTemplate || './template.handlebars'),
        'helpers': {
            'emptyResourceCheck': _emptyResourceCheckHelper,
            'emptyRequestCheck': _emptyRequestCheckHelper,
            'md': _markDownHelper,
            'mdFirstSentence': _markDownHelperFirstSentence,
	    'mdRest': _markDownHelperRest,
            'isSchemaUrl': _schemaUrlHelper,
            'lock': _lockIconHelper
        },
        'partials': {
            'resource': require(resourceTemplate || './resource.handlebars'),
            'item': require(itemTemplate || './item.handlebars')
        },
        processOutput: function(data, onSuccess, onError) {
            data = data.replace(/&quot;/g, '"');

            var Minimize = require('minimize');
            var minimize = new Minimize({loose: true});

            minimize.parse(data, function(error, result) {
                if (error) {
                    onError(error);
                } else {
                    onSuccess(result);
                }
            });
        }
    };
}


if (require.main === module) {
    program
        .usage('[options] [RAML input file]')
        .version(pjson.version)
        .option('-i, --input [input]', 'RAML input file')
        .option('-s, --https', 'Use https links in the generated output')
        .option('-o, --output [output]', 'HTML output file')
        .option('-t, --template [template]', 'Path to custom template.handlebars file')
        .option('-r, --resource [resource]', 'Path to custom resource.handlebars file')
        .option('-m, --item [item]', 'Path to custom item.handlebars file')
        .parse(process.argv);

    var input = program.input;

    if (!input) {
        if (program.args.length !== 1) {
            console.error('Error: You need to specify the RAML input file');
            program.help();
            process.exit(1);
        }

        input = program.args[0];
    }

    var https = program.https ? true : false;
    var mainTemplate = _parsePath(program.template);
    var resourceTemplate = _parsePath(program.resource);
    var itemTemplate = _parsePath(program.item);

    // Start the rendering process
    render(input, getDefaultConfig(https, mainTemplate, resourceTemplate, itemTemplate), function(result) {
        if (program.output) {
            fs.writeFileSync(program.output, result);
        } else {
            // Simply output to console
            process.stdout.write(result);
            process.exit(0);
        }
    }, function(error) {
        console.log('Error parsing: ' + error);
        process.exit(1);
    });
}


module.exports.getDefaultConfig = getDefaultConfig;
module.exports.render = render;
