/**
 * Created by Moyu on 16/10/14.
 */
var express = require('express');
var path = require('path');
var fs = require('fs');

var util = require('./util');
var computeDBJson = require('./generate').computeDBJson
var getFileJson = require('./generate').getFileJson
var getSorted = require('./generate').getSorted
var getTagMap = require('./generate').getTagMap
var initMarked = require('./generate').initMarked
var default_config = require('./default_config');

var STATIC_DIR = 'static';

module.exports = function (options) {
    var debug = !!options.debug;
    var port = options.port;
    var dir = options.dir;
    var doneCallback = options.doneCallback;
    var app = express();

    var mokaConfigPath = path.resolve(dir, 'moka.config.json'); //path.resolve解析出一个绝对路径
    var mokaconfig = require(mokaConfigPath);
    var config = util.deepAssign({}, default_config, mokaconfig);

    var marked = initMarked(config.marked, require('marked'))

    var theme = config.theme;
    var themeConfigPath = path.resolve(dir, 'themes', theme, 'theme.config.js');
    var themeConfigJsonPath = path.resolve(dir, 'themes', theme, 'theme.config.json');
    if(fs.existsSync(themeConfigPath)) {
        var themeConfig = require(themeConfigPath);
        delete themeConfig.theme;
        config = util.deepAssign({}, config, themeConfig);    
    }

    var themeBuild = path.resolve(dir, 'themes', theme, config.themeBuild)
    app.use(express.static(themeBuild))
    app.use(express.static(path.resolve(dir, 'source')))

    config.skipRegExp = eval(config.skipRegExp);
    var DB = computeDBJson(marked, dir, true, config);
    var articlesDir = path.resolve(dir, 'source', '_articles');

    fs.watch(articlesDir, function(eventType, filename) {
        debug && util.log(`event type is: ${eventType}`);
        if (filename) {
            debug && util.log(`filename provided: ${filename}`);
            try {
                updateDB(DB, filename, articlesDir, marked, config.skipRegExp, config.returnRaw, config.timeFormat);
            } catch (ex) {
                debug && util.pError(ex.message);
                deleteDB(DB, filename) && debug && util.log(`DB deleted: ${filename}`);
                return;
            }
            debug && util.log(`DB Updated!`);
        } else {
            debug && util.log('filename not provided');
        }
    })
    // var files = fs.readdirSync(articlesDir);
    
    // files.forEach(function(file) {
    //     if(!config.skipRegExp.test(file)) {
    //         fs.watchFile(file, function(curr, prev) {
    //             debug && util.log(`${file} updated.`);
    //             updateDB(DB, name, articlePath, returnRaw, timeFormat)
    //         })
    //     }
    // })
    

    //apiRoot
    app.all(`/${config.apiRoot}/:file`, function(req, res) {
        var origin = req.params.file;
        if(origin == 'moka.config.json') {
            res.sendFile(mokaConfigPath);
        } else if(origin == 'theme.config.json') {
            res.sendFile(themeConfigJsonPath);
        } else if(origin == 'db.json') {
            res.json(DB);
        }
    });

    app.listen(port, () => {
        debug && util.info(`Server run on http://localhost:${port}`)
    })

    process.on('SIGINT', () => {
        debug && util.info(`Bye!`)
        process.exit(1);
    })

    return app;
}

module.exports.deleteDB = deleteDB
module.exports.updateDB = updateDB

function deleteDB(DB, filename) {
    // [^.] 非点字符组成的字符串
    var href = filename.replace(/\.[^.]*$/, ''); //filename
    if(DB.main[href]) {
        var tags = DB.main[href].head.tags;
        var index = DB.index;
        var tagMap = index.tagMap;
        var sorted = index.sorted;
        if(tags) {
            if(!Array.isArray(tags)) {
                DB.main[href].head.tags = [tags]
            }//单个标签进行处理
            tags.forEach(function(t) {
                var i = tagMap[t].indexOf(href);
                if(i>=0) {
                    tagMap[t].splice(i, 1);
                }
            })
        }
        var j = sorted.indexOf(href);
        if(j>=0) {
            sorted.splice(j, 1);
        }
        delete DB.main[href];
        return true;
    }
}

function updateDB(DB, name, articlePath, marked, skipRegExp, returnRaw, timeFormat) {
    var href = name.replace(/\.[^.]*$/, '');
    var main = DB.main;
    try {
        var json = getFileJson(marked, articlePath, name, skipRegExp, returnRaw, timeFormat);
        if(json && json.head.skip) {
            delete main[href];
            DB.index = DB.index || {}
            DB.index.sorted = getSorted(main, timeFormat);
            DB.index.tagMap = getTagMap(main, DB.index.sorted);
            throw new Error(href + ' skipped.');
        }
        if(json) {
            if(main[href]) {
                main[href] = json;
            } else {
                main[href] = json;
                DB.index = DB.index || {}
                DB.index.sorted = getSorted(main, timeFormat);
                DB.index.tagMap = getTagMap(main, DB.index.sorted);
            }
        }
    } catch(ex) {
        throw ex;
    }
}