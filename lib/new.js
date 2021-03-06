/**
 * Created by Moyu on 16/10/16.
 */

var fs = require('fs');;
var util = require('./util');
var path = require('path');
var moment = require('moment');

module.exports = function (options) {
    var deb = options.debug;
    var dir = options.dir;
    var force = options.force;
    var name = options.name;
    if(!name || name.trim() == '') {
        deb && util.pError(`"${name}" is Bad Name.`)
        return false;
    }

    var filename = name.replace(/\s/g, '-');

    var articlePath = path.join(dir, 'template', 'article.md');/* 文件路径的拼接 */
    var tpl = fs.readFileSync(articlePath).toString();/* 读取文件 */

    tpl = tpl.replace(/\{\{\stitle\s\}\}/g, name)
        .replace(/\{\{\sdate\s\}\}/g, moment(new Date()).format('YYYY-MM-DD HH:mm:ss'))
    var distPath = path.join(dir, 'source', '_articles', filename+'.md');
    if(!force && fs.existsSync(distPath)) {
        deb && util.pError(`"${distPath}" already existed.`)
        return false;
    }

    fs.writeFileSync(distPath, tpl);
    deb && util.info(`new Article Done. "${distPath}"`);
    return true;
}