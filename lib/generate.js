/**
 * Created by Moyu on 16/10/14.
 */
var marked = require('marked');
var cls = require('colors/safe');
var path = require('path');
var fs = require('fs');
var moment = require('moment');
var copySync = require('fs-extra').copySync;
var removeSync = require('fs-extra').removeSync;

var version = require('../package.json').version;
var default_config = require('./default_config');
var util = require('./util');

var STATIC_DIR = "static";


module.exports = {
    getTagMap: getTagMap,
    getSorted: getSorted,
    getFileJson: getFileJson,
    initMarked: initMarked,
    computeDBJson: computeDBJson,

    generate: function (options) {
        var debug = !!options.debug;
        var dir = options.dir;
        var mokaconfig = require(path.resolve(dir, 'moka.config.json'));
        console.time("generate elapsed");
        var config = util.deepAssign({}, default_config, mokaconfig);
        var hooksEnable = !!config.hooks;
        var theme = config.theme;
        var themeConfigPath = path.resolve(dir, 'themes', theme, 'theme.config.js');

        if (!fs.existsSync(themeConfigPath)) {
            debug && util.pError(`Don't exists path "${themeConfigPath}"`)
        } else {
            var themeConfig = require(themeConfigPath);
            delete themeConfig.theme;
            config = util.deepAssign({}, config, themeConfig);
        }

        debug && util.info("generate configuration is ...");
        debug && console.log(config);
        debug && util.info("generating...");

        if (!config.returnRaw) {
            var markedConfig = config.marked;
            marked = initMarked(markedConfig, marked);
            debug && util.info("init Marked Done.");
        }


        var sourcePath = path.join(dir, 'source');
        var hooksPath = path.join(dir, 'hooks');

        hooksEnable && util.executeSyncWithCheck(path.join(hooksPath, 'pre-generate'))

        !fs.existsSync(STATIC_DIR) && fs.mkdirSync(STATIC_DIR);
        var files = fs.readdirSync(STATIC_DIR);
        files.forEach(x => {
            if (x.startsWith('.')) {
                return;
            }
            removeSync(path.join(STATIC_DIR, x));
            debug && util.info(`removed ${path.join(STATIC_DIR, x)} Done.`);
        })

        //对于非__articles目录下的文件直接进行拷贝
        fs.readdirSync(sourcePath).filter(x => x !== '_articles')
            .forEach(x => copySync(path.join(sourcePath, x), path.join(STATIC_DIR, x)))

        var themeBuildPath = path.join(dir, 'themes', theme, config.themeBuild);
        if (!fs.existsSync(themeBuildPath)) {
            util.pError(`Sorry, don't exists path "${themeBuildPath}"`)
            return false;
        }
        copySync(themeBuildPath, STATIC_DIR);
        debug && util.info(`copy Done Here. From "${themeBuildPath}".`);

        var injectFile = 'moka.inject.js';
        var file = path.join(STATIC_DIR, 'index.html')
        /**
            cheerio
            为服务器特别定制的，快速、灵活、实施的jQuery核心实现.
         */
        var cheerio = require('cheerio');
        var $ = cheerio.load(fs.readFileSync(file).toString('utf-8'));

        /**
            og是一种新的HTTP头部标记， Open Graph Protocol
            这种协议可以将网页吧变成富媒体对象。
            使用了改标签就表示你同意了网页内容可以被社交网站引用
         */
        if (!!config.inject) {
            $('head')
                .append(`    <meta name="description" content="${config.description}">\n`)
                .append(`    <meta property="og:type" content="blog">\n`)
                .append(`    <meta property="og:site_name" content="${config.siteName}">\n`)
            // .append(`    <script src="${injectFile}?v=${version}"></script>\n`)
            copySync(path.resolve(__dirname, '..', injectFile), path.join(STATIC_DIR, injectFile));
            debug && util.info(`inject Done.`);
        }

        if (!!config.title) {
            if ($('head title').length) {
                $('head title').text(config.title)
            } else {
                $('head')
                    .append(`   <title>${config.title}</title>\n`)
            }
            debug && util.info(`setTitle Done.`);
        }

        var now = moment(new Date()).format('YYYYMMDDHHmmss');
        $('script, link').each(function () {
            var el = $(this);
            if (el.prop('tagName').toLowerCase() === 'link') {
                if (el.attr('href') && !/\?/.test(el.attr('href'))) {
                    el.attr('href', el.attr('href') + '?v=' + now)
                }
            } else if (el.prop('tagName').toLowerCase() === 'script') {
                if (el.attr('src') && !/\?/.test(el.attr('src'))) {
                    el.attr('src', el.attr('src') + '?v=' + now)
                }
            }
        })

        if (!!config.favicon) {
            $('head').append(`    <link rel="icon" href="${config.favicon}?v=${now}">\n`)
            debug && util.info(`setFavicon Done.`);
        }

        var DB = makeApiFiles(config, marked, dir, debug);
        var dbstr = JSON.stringify(DB);
        var dbMd5 = util.md5(dbstr);
        var mokaConfigMd5 = util.md5(JSON.stringify(mokaconfig));
        var themeConfigMd5 = themeConfig ? util.md5(JSON.stringify(themeConfig)) : '';
        debug && util.info(`dbMd5: ${dbMd5}`);
        debug && util.info(`mokaConfigMd5: ${mokaConfigMd5}`);
        debug && util.info(`themeConfigMd5: ${themeConfigMd5}`);

        var bsData = {
            md5: {
                dbMd5: dbMd5, mokaConfigMd5: mokaConfigMd5, themeConfigMd5: themeConfigMd5
            }
        }
        var mokascript = `    <script>window.__moka__ = ${JSON.stringify(bsData)}</script>\n`
        if ($('script').length) {
            $('script').eq(0).before(mokascript);
        } else {
            $('head').prepend(mokascript);
        }

        fs.writeFileSync(file, $.html());

        util.infoTimeEnd("generate elapsed");

        hooksEnable && util.executeSyncWithCheck(path.join(hooksPath, 'post-generate'))

        return true;
    }
}

function makeApiFiles(options, marked, dir, debug) {
    var apiRoot = options.apiRoot;
    var skipRegExp = eval(options.skipRegExp);
    var timeFormat = options.timeFormat;

    var apiPath = path.join(dir, STATIC_DIR, apiRoot);
    var themePath = path.join(dir, 'themes', options.theme);

    !fs.existsSync(apiPath) && fs.mkdirSync(apiPath);

    copySync(path.join(themePath, 'theme.config.json'), path.join(apiPath, 'theme.config.json'));
    copySync(path.join(dir, 'moka.config.json'), path.join(apiPath, 'moka.config.json'));

    var DB = computeDBJson(marked, dir, debug, {
        timeFormat: timeFormat,
        skipRegExp: skipRegExp,
        returnRaw: options.returnRaw
    });

    var dbPath = path.join(apiPath, 'db.json');
    fs.writeFileSync(dbPath, JSON.stringify(DB));
    debug && util.info(`write DB done.`);
    return DB;
}

/**
    构建DB json文件
    @ marked
    @ dir
    @ debug
    @ options

    
 */

//  {
//     "main": {
//         "b_vs_strong_&_i_vs_em_(html标签语义化)": {
//             "content": "<h1><a name=\"-html-\" class=\"anchor\" href=\"#-html-\"><span class=\"header-link\"></span></a>关于html标签语义化</h1><p><a href=\"http://baike.baidu.com/link?url=WuGJOFv_8m6MKYsARovHAFV-dD_cR9IIInPoAj8BTcn9mUZ1gsbPKUmgScuTJNGyjMq3vSDz8XpE1RKbGN_7Lq\">百度百科</a>\n用自己的话来说，就是一个是用来给人看的（语义化，如header/footer/nav...）,\n一个是给机器看的（如一大堆的div，通过css一样可以达到效果）</p>\n<blockquote>\n<p>语义化的网页的好处，最主要的就是对搜索引擎友好，有了良好的结构和语义你的网页内容自然容易被搜索引擎抓取，你网站的推广便可以省下不少的功夫。\n语义 Web 技术有助于利用基于开放标准的技术，从数据、文档内容或应用代码中分离出意义。</p>\n</blockquote>\n<!--more-->\n<h1><a name=\"-\" class=\"anchor\" href=\"#-\"><span class=\"header-link\"></span></a>正题</h1><p>关于<code>b/strong</code> &amp; <code>i/em</code>讨论，<a href=\"http://www.zhihu.com/question/19551271\">知乎</a>\n<code>b</code>和<code>i</code> 是没有感情色彩的，只是一个文本样式而已。\n<code>strong</code>和<code>em</code> 有感情色彩，\n<code>strong</code> 加重语气。最重的那种。\n<code>em</code> 同为加强语气，但气势弱些。\n那么有无感情色彩有什么作用呢？\n其实web有个听觉系统，能将页面内容<strong>读</strong>出来，详细请看<a href=\"http://www.w3school.com.cn/cssref/css_ref_aural.asp\">CSS听觉参考</a>\n而 <code>em/strong</code> 在机器识别发音的时候会产生重读效果。</p>\n<h1><a name=\"demo\" class=\"anchor\" href=\"#demo\"><span class=\"header-link\"></span></a>demo</h1><p><strong>I&#39;m <code>strong</code></strong>\n<b>I&#39;m <code>b</code></b>\n<em>I&#39;m <code>em</code></em>\n<i>I&#39;m <code>i</code></i></p>\n",
//             "head": {
//                 "title": "b vs strong & i vs em (html标签语义化)",
//                 "date": "24 Apr 2016",
//                 "categories": [
//                     "前端"
//                 ],
//                 "tags": [
//                     "html"
//                 ],
//                 "realDate": "2016-04-24 14:48:18"
//             }
//         },
//         "linux-C一周学习": {
//             "content": "<!-- # linux C一周学习 & node c addon -->\n<p>还记得大一懵懂的时候，第一门专业课便是C语言了，当时都没接触过编程，而且用的是win32，老师也讲的就是一些<code>if while</code>语法知识，指针数组等等。</p>\n<p>没有涉及到linux系统调用函数，不过也理所当然，因为当时根本对操作系统，汇编，计算机系统等一概不懂，讲了也只是换来更多的懵逼脸。</p>\n<p>那三年后的我，为什么又重新学习C呢？  </p>\n<!--more-->\n<p>因为大四还有一门tcp/ip网络编程，老师和书本是基于<code>unix socket</code>和<code>winsocket</code>的。其实在大三网络课里面，老师就有要求完成一个tcp和udp的聊天程序，当时用的是<code>nodejs</code>的<code>net package</code>. 使用node完成的可就简单了，net包为你实现了请求的队列和一套异步编程api。</p>\n<p><strong>但在c中，socket只是一个位于tcp/udp之上的一层，多请求的处理，你可以采用多进程/多线程，也可以采用单进程轮询处理（往往搭配非阻塞IO）；IO操作你也可以使用阻塞和非阻塞，随你喜欢。</strong></p>\n<p>但这些名词，只有在你理解了计算机系统后才能运用自如。</p>\n<p>而且C也可以与node结合起来，参看<a href=\"https://github.com/nodejs/node-addon-examples/\">node addon</a>，所以之后遇到计算量大和趋向底层的活，完全可以交给c实现。</p>\n<p>于是乎，我便开始了学习linux c之旅。</p>\n<h2><a name=\"-\" class=\"anchor\" href=\"#-\"><span class=\"header-link\"></span></a>疑难总结</h2><ol>\n<li><p><code>char* a = &quot;123&quot;;</code>与 <code>char b[] = &quot;123&quot;;</code><br>在执行<code>char* a = &quot;123&quot;;</code>时，编译器会把<code>&quot;123&quot;</code>当成字符串常量，而a指向的正式<code>&#39;a&#39;</code>的地址，而字符串的结束标志为<code>&#39;\\0&#39;</code>. 这就是为什么不能<code>strcat(a, b)</code>, 因为a指向的是常量字符串。<br>那么下面这段程序执行时什么结果呢？</p>\n<pre><code class=\"lang-c\"><span class=\"hljs-keyword\">char</span>* x = <span class=\"hljs-string\">\"123\"</span>;\n<span class=\"hljs-keyword\">char</span> y[] = <span class=\"hljs-string\">\"123\"</span>;\n<span class=\"hljs-built_in\">printf</span>(<span class=\"hljs-string\">\"%s %s %d %d %d\\n\"</span>, <span class=\"hljs-built_in\">strcat</span>(y, x), y, <span class=\"hljs-keyword\">sizeof</span>(y), <span class=\"hljs-built_in\">strlen</span>(y), <span class=\"hljs-keyword\">sizeof</span>(x));\n<span class=\"hljs-comment\">// 123123 123123 4 6 8</span>\n</code></pre>\n</li><li><p><code>char** s;</code> 二级指针</p>\n<pre><code class=\"lang-c\">char  **s<span class=\"hljs-comment\">;  </span>\n*s = <span class=\"hljs-string\">\"hello world\"</span><span class=\"hljs-comment\">;</span>\n</code></pre>\n<p>上面这段程序是有错的，因为没有给s分配空间,也就是s指向（值）为空（不可读写），\n<code>malloc</code>之后，s指向一个可以读写的内存块。</p>\n</li></ol>\n<p>更多参看 <a href=\"http://blog.csdn.net/daiyutage/article/details/8604720\">http://blog.csdn.net/daiyutage/article/details/8604720</a></p>\n<h2><a name=\"-\" class=\"anchor\" href=\"#-\"><span class=\"header-link\"></span></a>知识总结</h2><ol>\n<li>网络编程  <ol>\n<li>如何知道服务器或者客户端断开了连接？（read() == 0）</li><li>处理多请求的俩种服务器实现（fork/select）</li><li>一些&quot;奇怪&quot;现象的解释<ol>\n<li>主动关闭连接的一方要处于TIME_WAIT状态，等待两个MSL（maximum segment lifetime）的时间后才能回到CLOSED状态 </li><li>网络服务器通常用fork来同时服务多个客户端，父进程专门负责监听端口，每次accept一个新的客户端连接就fork出一个子进程专门服务这个客户端。但是子进程退出时会产生僵尸进程，父进程要注意处理SIGCHLD信号和调用wait清理僵尸进程。</li><li>server对每个请求只处理一次，应答后就关闭连接，client不能继续使用这个连接发送数据。但是client下次循环时又调用write发数据给server，write调用只负责把数据交给TCP发送缓冲区就可以成功返回了，所以不会出错，而server收到数据后应答一个RST段，client收到RST段后无法立刻通知应用层，只把这个状态保存在TCP协议层。client下次循环又调用write发数据给server，由于TCP协议层已经处于RST状态了，因此不会将数据发出，而是发一个SIGPIPE信号给应用层，SIGPIPE信号的缺省处理动作是终止程序</li></ol>\n</li></ol>\n</li><li>进程<ol>\n<li>shell的工作方式，fork -&gt; exec</li><li>fork与exec</li><li>shell的实现，改变current work path, 实现pipe与输入输出重定向</li><li>...</li></ol>\n</li><li>文件系统<ol>\n<li>erverything is file</li><li>dup与dup2运用, 重定向</li><li>link/ln  stat/lstat</li><li>...</li></ol>\n</li><li>库函数与系统函数</li></ol>\n<h2><a name=\"-\" class=\"anchor\" href=\"#-\"><span class=\"header-link\"></span></a>编码实践</h2><p>学的虽然挺多的，但是需要做的东西出来才能掌握。</p>\n<ol>\n<li><p>c实现shell (掌握linux内核函数，进程管道通信，文件描述符等概念)<br> <a href=\"https://github.com/moyuyc/c_cpp-node_c_cpp_addon/blob/master/cpp_src/shell.h\">source file</a></p>\n</li><li><p>tcp双向通信 (select()/fork()两种方式)<br> <a href=\"https://github.com/moyuyc/c_cpp-node_c_cpp_addon/blob/master/cpp_src/server.h\">source file Server</a><br> <a href=\"https://github.com/moyuyc/c_cpp-node_c_cpp_addon/blob/master/cpp_src/client.h\">source file Client</a></p>\n</li><li><p>node addon(node调用c/c++)<br> <a href=\"https://github.com/moyuyc/c_cpp-node_c_cpp_addon/tree/master/node_src\">source file</a></p>\n</li></ol>\n<h2><a name=\"-\" class=\"anchor\" href=\"#-\"><span class=\"header-link\"></span></a>闲话</h2><p>上面简单总结了一下知识和成果，我觉得学习linux c是十分必要的，可以将整个计算机系统理论串联起来，而且后续有必要的话，完全可以重零开始，自己造轮子。</p>\n<p>然后推荐两个项目，都是用linux c写的</p>\n<ol>\n<li><p><a href=\"https://github.com/EZLippi/Tinyhttpd\">TinyHttpd</a><br>500+行代码实现一个小型web服务器，助于理解web 服务器本质，而不再是只会使用现成的web服务器。代码不多，便于学习。</p>\n</li><li><p><a href=\"https://github.com/posva/catimg\">catimg</a><br>将图片print在shell中，便于学习unix字符转义，shell窗口控制，图像处理</p>\n</li></ol>\n<p>最后力荐一本电子书<a href=\"http://akaedu.github.io/book/\">【Linux C编程一站式学习】</a>，学习linux C就靠它！</p>\n",
//             "head": {
//                 "title": "linux C一周学习",
//                 "date": "12 Oct 2016",
//                 "tags": [
//                     "linux",
//                     "c"
//                 ],
//                 "cover": "http://ww2.sinaimg.cn/mw690/b2b1bff9jw1f8tf00mm95j20sg0izah4.jpg",
//                 "realDate": "2016-10-12 12:57:36"
//             }
//         },
//         "MarkDown语法测试Demo": {
//             "content": "<h1><a name=\"-\" class=\"anchor\" href=\"#-\"><span class=\"header-link\"></span></a>一级标题</h1><pre><code><span class=\"hljs-meta\"># 一级标题(前后含空格)</span>\n</code></pre><h2><a name=\"-\" class=\"anchor\" href=\"#-\"><span class=\"header-link\"></span></a>二级标题</h2><pre><code>## 二级标题 \n</code></pre><p>...以此类推\n<!--more--></p>\n<p><strong>粗体字</strong></p>\n<pre><code>*<span class=\"hljs-strong\">*粗体字*</span><span class=\"hljs-strong\">*</span>\n</code></pre><p><em>斜体字</em></p>\n<pre><code><span class=\"hljs-strong\">*斜体字*</span> \n</code></pre><p><strong><em>粗斜体字</em></strong></p>\n<pre><code>**<span class=\"hljs-strong\">*粗斜体字*</span>*<span class=\"hljs-strong\">*</span>\n</code></pre><blockquote>\n<p>引用块</p>\n</blockquote>\n<p><code>&gt; 引用块</code></p>\n<p>水平分割线</p>\n<hr>\n<p><code>------</code></p>\n<p><a href=\"http://baidu.com\">超链接</a>\n<code>[超链接](http://baidu.com)</code></p>\n<p><code>行内代码</code></p>\n<pre><code>行代码块\n</code></pre><pre><code><span class=\"hljs-comment\">/*\n * 高亮代码块\n */</span>\n <span class=\"hljs-keyword\">var</span> moyu = <span class=\"hljs-string\">'A Boy'</span>;\n <span class=\"hljs-built_in\">window</span>.moyu = <span class=\"hljs-string\">''</span>;\n</code></pre><ul>\n<li>无序列表项 一</li><li>无序列表项 二</li><li>无序列表项 三</li></ul>\n<pre><code>-<span class=\"ruby\"> 无序列表项 一\n</span>-<span class=\"ruby\"> 无序列表项 二\n</span>-<span class=\"ruby\"> 无序列表项 三</span>\n</code></pre><ol>\n<li>有序列表项 一</li><li>有序列表项 二</li><li>有序列表项 三</li></ol>\n<pre><code><span class=\"hljs-bullet\">1. </span>有序列表项 一\n<span class=\"hljs-bullet\">2. </span>有序列表项 二\n<span class=\"hljs-bullet\">3. </span>有序列表项 三\n</code></pre><p><img src=\"/images/img.jpg\" alt=\"图片\"></p>\n<pre><code>![<span class=\"hljs-string\">图片</span>](<span class=\"hljs-link\">/images/img.jpg</span>)\n</code></pre><table>\n<thead>\n<tr>\n<th>项目</th>\n<th style=\"text-align:right\">价格</th>\n<th style=\"text-align:center\">数量</th>\n</tr>\n</thead>\n<tbody>\n<tr>\n<td>计算机</td>\n<td style=\"text-align:right\">\\$1600</td>\n<td style=\"text-align:center\">5</td>\n</tr>\n<tr>\n<td>手机</td>\n<td style=\"text-align:right\">\\$12</td>\n<td style=\"text-align:center\">12</td>\n</tr>\n<tr>\n<td>管线</td>\n<td style=\"text-align:right\">\\$1</td>\n<td style=\"text-align:center\">234</td>\n</tr>\n</tbody>\n</table>\n<pre><code><span class=\"hljs-variable\">&lt;table&gt;</span>\n  <span class=\"hljs-variable\">&lt;thead&gt;</span>\n   <span class=\"hljs-variable\">&lt;tr&gt;</span>\n     <span class=\"hljs-variable\">&lt;th&gt;</span>Head1<span class=\"hljs-variable\">&lt;/th&gt;</span>\n     <span class=\"hljs-variable\">&lt;th&gt;</span>Head2<span class=\"hljs-variable\">&lt;/th&gt;</span>\n     <span class=\"hljs-variable\">&lt;th&gt;</span>Head3<span class=\"hljs-variable\">&lt;/th&gt;</span>\n     <span class=\"hljs-variable\">&lt;th&gt;</span>Head4<span class=\"hljs-variable\">&lt;/th&gt;</span>\n   <span class=\"hljs-variable\">&lt;/tr&gt;</span>\n  <span class=\"hljs-variable\">&lt;/thead&gt;</span>\n  <span class=\"hljs-variable\">&lt;tbody&gt;</span>\n   <span class=\"hljs-variable\">&lt;tr&gt;</span>\n      <span class=\"hljs-variable\">&lt;td&gt;</span>John<span class=\"hljs-variable\">&lt;/td&gt;</span>\n      <span class=\"hljs-variable\">&lt;td&gt;</span>Smith<span class=\"hljs-variable\">&lt;/td&gt;</span>\n      <span class=\"hljs-variable\">&lt;td&gt;</span>123 Main St.<span class=\"hljs-variable\">&lt;/td&gt;</span>\n      <span class=\"hljs-variable\">&lt;td&gt;</span>Springfield<span class=\"hljs-variable\">&lt;/td&gt;</span>\n   <span class=\"hljs-variable\">&lt;/tr&gt;</span>\n   <span class=\"hljs-variable\">&lt;tr&gt;</span>\n      <span class=\"hljs-variable\">&lt;td&gt;</span>Mary<span class=\"hljs-variable\">&lt;/td&gt;</span>\n      <span class=\"hljs-variable\">&lt;td&gt;</span>Jones<span class=\"hljs-variable\">&lt;/td&gt;</span>\n      <span class=\"hljs-variable\">&lt;td&gt;</span>456 Pine St.<span class=\"hljs-variable\">&lt;/td&gt;</span>\n      <span class=\"hljs-variable\">&lt;td&gt;</span>Dover<span class=\"hljs-variable\">&lt;/td&gt;</span>\n   <span class=\"hljs-variable\">&lt;/tr&gt;</span>\n   <span class=\"hljs-variable\">&lt;tr&gt;</span>\n      <span class=\"hljs-variable\">&lt;td&gt;</span>Jim<span class=\"hljs-variable\">&lt;/td&gt;</span>\n      <span class=\"hljs-variable\">&lt;td&gt;</span>Baker<span class=\"hljs-variable\">&lt;/td&gt;</span>\n      <span class=\"hljs-variable\">&lt;td&gt;</span>789 Park Ave.<span class=\"hljs-variable\">&lt;/td&gt;</span>\n      <span class=\"hljs-variable\">&lt;td&gt;</span>Lincoln<span class=\"hljs-variable\">&lt;/td&gt;</span>\n   <span class=\"hljs-variable\">&lt;/tr&gt;</span>\n <span class=\"hljs-variable\">&lt;/tbody&gt;</span>\n<span class=\"hljs-variable\">&lt;/table&gt;</span>\n\n|<span class=\"hljs-string\"> 项目        </span>|<span class=\"hljs-string\"> 价格   </span>|<span class=\"hljs-string\">  数量  </span>|\n|<span class=\"hljs-string\"> --------   </span>|<span class=\"hljs-string\"> -----:  </span>|<span class=\"hljs-string\"> :----:  </span>|\n|<span class=\"hljs-string\"> 计算机     </span>|<span class=\"hljs-string\"> \\$1600 </span>|<span class=\"hljs-string\">   5     </span>|\n|<span class=\"hljs-string\"> 手机        </span>|<span class=\"hljs-string\">   \\$12   </span>|<span class=\"hljs-string\">   12   </span>|\n|<span class=\"hljs-string\"> 管线        </span>|<span class=\"hljs-string\">    \\$1    </span>|<span class=\"hljs-string\">  234  </span>|\n</code></pre><p>参考 <a href=\"https://www.zybuluo.com/mdeditor?url=https://www.zybuluo.com/static/editor/md-help.markdown#cmd-markdown-高阶语法手册\">Cmd Markdown 高阶语法手册</a> 了解更多高级功能。</p>\n",
//             "head": {
//                 "title": "MarkDown语法测试Demo",
//                 "date": "22 Apr 2016",
//                 "tags": "MarkDown",
//                 "categories": [
//                     "Studying"
//                 ],
//                 "realDate": "2016-04-22 09:57:09"
//             }
//         },
//         "npm命令行小结": {
//             "content": "<h1><a name=\"yarn\" class=\"anchor\" href=\"#yarn\"><span class=\"header-link\"></span></a>yarn</h1><p>最近停到facebook又出了个yarn, 新的node package manager. \n噱头是安装能够直接找缓存，不需要每次从网上下。</p>\n<p>于是<code>npm i -g yarn</code>安装后，使用了一番，觉得也就那样，还需要把<code>yarn.lock</code>放到项目中，</p>\n<p><strong>其实<code>npm</code>对于cache也有一些指令处理的。</strong>\n<!--more--></p>\n<h1><a name=\"npm\" class=\"anchor\" href=\"#npm\"><span class=\"header-link\"></span></a>npm</h1><pre><code><span class=\"hljs-built_in\">npm</span> cache ls\n</code></pre><p>可以查看你本地的cache，之前你的每一次<code>install</code>都会在本地有cache的，默认是放在<code>$HOME/.npm</code>中\n    npm cache clean\n清除本地cache</p>\n<pre><code>npm <span class=\"hljs-keyword\">install </span>react --<span class=\"hljs-keyword\">cache-min </span><span class=\"hljs-number\">6000</span>\n</code></pre><p>上面<code>--cache-min</code>指的是是否需要从缓存里面取package，时间不超过6000分钟，超过6000分钟也将从网上download，\n还可以<code>--cache-min=Infinity</code>，分钟数设为无穷，这样可以保证了包下载的速度。</p>\n<pre><code>npm <span class=\"hljs-keyword\">install</span> <span class=\"hljs-comment\">--only=dev</span>\n</code></pre><p>将会只安装<code>package.json</code>中的<code>devDependencies</code>, 对立的是<code>--only=production</code></p>\n<h1><a name=\"more\" class=\"anchor\" href=\"#more\"><span class=\"header-link\"></span></a>more</h1><p><a href=\"http://www.ruanyifeng.com/blog/2016/01/npm-install.html\"> 阮一峰 npm 模块安装机制简介</a></p>\n",
//             "head": {
//                 "title": "npm命令行小结",
//                 "date": "13 Oct 2016",
//                 "tags": [
//                     "npm"
//                 ],
//                 "realDate": "2016-10-13 10:39:06"
//             }
//         },
//         "requestAnimationFrame_Vs_setInterval": {
//             "content": "<h1><a name=\"-\" class=\"anchor\" href=\"#-\"><span class=\"header-link\"></span></a>介绍</h1><p>大家对setInterval一定不陌生，但可能不太了解requestAnimationFrame\nrequestAnimationFrame是HTML5新添的api，两者都能产生动画效果。</p>\n<h1><a name=\"-\" class=\"anchor\" href=\"#-\"><span class=\"header-link\"></span></a>区别</h1><p>requestAnimationFrame 参数只有一个参数，是用来循环调用的方法，\nsetInterval 有两个参数，第一个是方法，第二个是循环调用的时间。\n<strong>但是，JavaScript是单线程的，也就是同一时间只能有一句JavaScript语句执行所以，setInterval的实现是通过事件驱动完成的，当时间到了之后，setInterval加入事件队列，等待JavaScript的青睐，所以这种计时是不准确的。</strong>\n<!--more--></p>\n<h2><a name=\"demo\" class=\"anchor\" href=\"#demo\"><span class=\"header-link\"></span></a>Demo</h2><script>function progress(p){p.style.width='0%';p.innerText='0%';function run(){var w = parseInt(p.style.width);p.innerText = w +'%';if(w==100) return;p.style.width = w+1+'%';setTimeout(arguments.callee,15)}setTimeout(run,15);}</script>\n<p id='progress' style=\"width:0%;background-color:blue;color:white\">0</p>\n<button onclick=\"progress(document.querySelector('#progress'));\">RUN</button>\n<script>progress(document.querySelector('#progress'));</script>\n\n<pre><code><span class=\"hljs-function\"><span class=\"hljs-keyword\">function</span> <span class=\"hljs-title\">progress</span>(<span class=\"hljs-params\">p</span>)</span>{\n    p.style.width=<span class=\"hljs-string\">'0%'</span>;\n    p.innerText=<span class=\"hljs-string\">'0%'</span>;\n    <span class=\"hljs-function\"><span class=\"hljs-keyword\">function</span> <span class=\"hljs-title\">run</span>(<span class=\"hljs-params\"></span>)</span>{\n        <span class=\"hljs-keyword\">var</span> w = <span class=\"hljs-built_in\">parseInt</span>(p.style.width);\n        p.innerText = w +<span class=\"hljs-string\">'%'</span>;\n        <span class=\"hljs-keyword\">if</span>(w==<span class=\"hljs-number\">100</span>) <span class=\"hljs-keyword\">return</span>;\n        p.style.width = w+<span class=\"hljs-number\">1</span>+<span class=\"hljs-string\">'%'</span>;\n        requestAnimationFrame(<span class=\"hljs-built_in\">arguments</span>.callee)\n    }\n    requestAnimationFrame(run);\n}\n</code></pre><script>function progress2(p){p.style.width='0%';p.innerText='0%';function run(){var w = parseInt(p.style.width);p.innerText = w +'%';if(w==100){clearInterval(t); return;}p.style.width = w+1+'%';}var t =setInterval(run,15);}</script>\n\n<p><p id='progress2' style=\"width:0%;background-color:blue;color:white\">0</p></p>\n<button onclick=\"progress2(document.querySelector('#progress2'));\">RUN</button>\n\n<script>progress2(document.querySelector('#progress2'));</script>\n\n<pre><code><span class=\"hljs-function\"><span class=\"hljs-keyword\">function</span> <span class=\"hljs-title\">progress2</span>(<span class=\"hljs-params\">p</span>)</span>{\n    p.style.width=<span class=\"hljs-string\">'0%'</span>;\n    p.innerText=<span class=\"hljs-string\">'0%'</span>;\n    <span class=\"hljs-function\"><span class=\"hljs-keyword\">function</span> <span class=\"hljs-title\">run</span>(<span class=\"hljs-params\"></span>)</span>{\n        <span class=\"hljs-keyword\">var</span> w = <span class=\"hljs-built_in\">parseInt</span>(p.style.width);\n        p.innerText = w +<span class=\"hljs-string\">'%'</span>;\n        <span class=\"hljs-keyword\">if</span>(w==<span class=\"hljs-number\">100</span>){\n            clearInterval(t); <span class=\"hljs-keyword\">return</span>;\n        }\n        p.style.width = w+<span class=\"hljs-number\">1</span>+<span class=\"hljs-string\">'%'</span>;\n    }\n    <span class=\"hljs-keyword\">var</span> t =setInterval(run,<span class=\"hljs-number\">15</span>);\n}\n</code></pre><p> 可以看到，<code>requestAnimationFrame</code>代码量更少。</p>\n<h1><a name=\"-\" class=\"anchor\" href=\"#-\"><span class=\"header-link\"></span></a>惊天秘密</h1><p> <strong>深入理解，可以把<code>requestAnimationFrame(func)</code>等效为<code>setTimeout(func,15);</code></strong>\n 不信，你试下嘛。\n 当然，<code>requestAnimationFrame</code>在浏览器查看其它网页的一段时间后，便会自动停止动画。\n 在threejs中，就是用<code>requestAnimationFrame</code>来减少cpu负载的。\n <strong>2016/5/15 更新</strong>\n <code>requestAnimationFrame</code> 中会默认传入一个相对的时间戳，<a href=\"https://developer.mozilla.org/en-US/docs/Web/API/window/requestAnimationFrame\">详细看这里</a>；\n <code>setTimeout(func,15);</code>除了这种用法以外，还可以<code>setTimeout(func,15,args);</code>传入参数，当然<code>setInterval</code>也一样。</p>\n",
//             "head": {
//                 "title": "requestAnimationFrame Vs setInterval",
//                 "date": "23 Apr 2016",
//                 "tags": [
//                     "js"
//                 ],
//                 "categories": [
//                     "前端"
//                 ],
//                 "realDate": "2016-04-23 11:52:58"
//             }
//         },
//         "「ECMAScript6」Promise介绍与nodejs实践运用(q.js)": {
//             "content": "<h1><a name=\"-\" class=\"anchor\" href=\"#-\"><span class=\"header-link\"></span></a>介绍</h1><p>看了网上许多介绍 <code>Promise</code> 的文章，终于知道 <code>Promise</code> 是什么，干什么的了。\n首先需要指出的是，<strong>promise是es6提出的新标准之一</strong>，那么提出这个标准是用来做什么的呢？\n<!--more-->\n写过js代码的童鞋一定知道，异步回调函数是js的一大特点，那么异步回调函数带来的问题是什么呢？会造成函数嵌套过多，不宜于后期代码的维护，许多的<code>({})</code>也容易把我们搞得晕头转向。那么promise便是用来解决该问题。\n那么es6提出这个标准，那么就得有人按照这个标准来实现吧，于是百家争鸣，出现许多库(以便在非浏览器环境下使用)，在这我介绍 <code>q.js</code>.\n<a href=\"https://github.com/kriskowal/q\"><code>q.js</code> github地址</a></p>\n<h1><a name=\"-\" class=\"anchor\" href=\"#-\"><span class=\"header-link\"></span></a>使用</h1><ul>\n<li>安装<code>q.js</code>\n  npm install q</li><li>使用</li></ul>\n<ol>\n<li><p>使用<code>Q.nfcall</code></p>\n<pre><code class=\"lang-javascript\"><span class=\"hljs-keyword\">var</span> fs = <span class=\"hljs-built_in\">require</span>(<span class=\"hljs-string\">'fs'</span>),\n Q   = <span class=\"hljs-built_in\">require</span>(<span class=\"hljs-string\">'q'</span>);\n<span class=\"hljs-keyword\">var</span> promise = Q.nfcall(fs.readFile,<span class=\"hljs-string\">'run.js'</span>);\npromise.then(<span class=\"hljs-function\"><span class=\"hljs-keyword\">function</span>(<span class=\"hljs-params\">data</span>)</span>{\n     <span class=\"hljs-built_in\">console</span>.log(data);\n },<span class=\"hljs-function\"><span class=\"hljs-keyword\">function</span>(<span class=\"hljs-params\">err</span>)</span>{\n     <span class=\"hljs-built_in\">console</span>.err(err);\n });\n</code></pre>\n<p> 或者可以简写为下面</p>\n<pre><code> promise.<span class=\"hljs-keyword\">then</span>(<span class=\"hljs-built_in\">console</span>.log,<span class=\"hljs-built_in\">console</span>.err);\n</code></pre></li><li><p>使用<code>Q.deferd</code></p>\n<pre><code class=\"lang-javascript\"><span class=\"hljs-keyword\">var</span> preadFile = <span class=\"hljs-function\"><span class=\"hljs-keyword\">function</span>(<span class=\"hljs-params\">file</span>)</span>{\n <span class=\"hljs-keyword\">var</span> deferred = Q.defer();\n fs.readFile(file,  <span class=\"hljs-function\"><span class=\"hljs-keyword\">function</span> (<span class=\"hljs-params\">error, text</span>) </span>{\n     <span class=\"hljs-keyword\">if</span> (error) {\n         deferred.reject(<span class=\"hljs-keyword\">new</span> <span class=\"hljs-built_in\">Error</span>(error));\n     } <span class=\"hljs-keyword\">else</span> {\n         deferred.resolve(text);\n     }\n });\n <span class=\"hljs-keyword\">return</span> deferred.promise;\n};\npreadFile(<span class=\"hljs-string\">'run.js'</span>).then(<span class=\"hljs-built_in\">console</span>.log,<span class=\"hljs-built_in\">console</span>.err);\n</code></pre>\n</li><li><p>还可以用<code>Q.all</code>实现<strong>同步方式</strong></p>\n<pre><code class=\"lang-javascript\"><span class=\"hljs-keyword\">var</span> promise = Q.all([Q.nfcall(fs.readFile,<span class=\"hljs-string\">'run.js'</span>),preadFile(<span class=\"hljs-string\">'event.js'</span>),preadFile(<span class=\"hljs-string\">'nofound.js'</span>)]);\npromise.then(<span class=\"hljs-function\"><span class=\"hljs-keyword\">function</span>(<span class=\"hljs-params\">data</span>)</span>{<span class=\"hljs-built_in\">console</span>.log(data.toString())},<span class=\"hljs-built_in\">console</span>.error);\n</code></pre>\n<p> 因为<code>nofound.js</code>不存在所以会抛出异常，其他文件即使存在也不会正确执行.</p>\n</li><li><p>多层嵌套<strong>异步方式</strong>\n```javascript\nvar preadFile = function(file){\n var deferred = Q.defer();\n fs.readFile(file,  function (error, text) {</p>\n<pre><code> <span class=\"hljs-keyword\">if</span> (<span class=\"hljs-keyword\">error</span>) {\n     deferred.reject(new Error(<span class=\"hljs-keyword\">error</span>));\n } <span class=\"hljs-keyword\">else</span> {\n     deferred.resolve({data:<span class=\"hljs-built_in\">text</span>,<span class=\"hljs-built_in\">file</span>:<span class=\"hljs-built_in\">file</span>});\n }\n</code></pre><p> });\n return deferred.promise;\n};</p>\n</li></ol>\n<p>preadFile(&#39;run.js&#39;)\n    .then(function (d) {\n        console.log(d);\n        return d.file+&#39;xx&#39;;\n    })\n    .then(preadFile)  //上面return d.file 传递到preadFile中\n    .then(function (d) {\n        console.log(d);\n        return d.file;\n    })\n    .catch(function (e) {\n        console.log(e);\n    }).done(function (e) {//最后一个then return的参数\n        console.log(e);\n    });\n<code>``\n    上面的代码</code>run.js<code>将会正确输出，但是因为不存在</code>run.jsxx<code>文件所以会捕获错误，但不影响</code>run.js`的输出。</p>\n<h1><a name=\"-\" class=\"anchor\" href=\"#-\"><span class=\"header-link\"></span></a>尾声</h1><p>更多的用法参考<a href=\"https://github.com/kriskowal/q\"><code>q.js</code> github地址</a>\n原来我以前一直使用的 <code>$.ajax({}).fail().done()</code> 正是promise方式的一种。</p>\n",
//             "head": {
//                 "title": "「ECMAScript6」Promise介绍与nodejs实践运用(q.js)",
//                 "date": "01 May 2016",
//                 "categories": [
//                     "后端"
//                 ],
//                 "tags": [
//                     "EMCAScript6",
//                     "promise",
//                     "nodejs"
//                 ],
//                 "realDate": "2016-05-01 09:56:42"
//             }
//         },
//         "谈谈JavaScript之数组对象深拷贝": {
//             "content": "<h1><a name=\"-\" class=\"anchor\" href=\"#-\"><span class=\"header-link\"></span></a>回忆</h1><p>上周百度面试问了我关于数组的 <code>clone</code> 方法的实现，当时没来得及细想，然后口头上说</p>\n<blockquote>\n<p>数组就是一串数据序列，可以遍历然后进行深拷贝即可。</p>\n</blockquote>\n<p>关于细节实现的东西都没想，然后面试官那边好像就无语了... 不过好在我提到了 <code>深拷贝</code> 这个关键字。\n<!--more--></p>\n<h1><a name=\"-clone\" class=\"anchor\" href=\"#-clone\"><span class=\"header-link\"></span></a>再探clone</h1><h2><a name=\"-\" class=\"anchor\" href=\"#-\"><span class=\"header-link\"></span></a>浅复制</h2><p>先看第一段代码</p>\n<pre><code class=\"lang-javascript\"><span class=\"hljs-built_in\">Array</span>.prototype.clone = <span class=\"hljs-function\"><span class=\"hljs-keyword\">function</span>(<span class=\"hljs-params\"></span>)</span>{\n    <span class=\"hljs-keyword\">return</span> <span class=\"hljs-keyword\">this</span>.slice();\n}\n</code></pre>\n<p>乍看一下，好像挺快捷方便的就完成了。实际上，懂得c++/java中浅拷贝/深拷贝的人一看便知道这只是实现了浅复制。\n测试代码如下，</p>\n<pre><code class=\"lang-javascript\"><span class=\"hljs-keyword\">var</span> arr = [<span class=\"hljs-number\">1</span>,<span class=\"hljs-keyword\">new</span> <span class=\"hljs-function\"><span class=\"hljs-keyword\">function</span> <span class=\"hljs-params\">(x)</span></span>{\n                   this.x=x;\n               }(<span class=\"hljs-number\">3</span>)];\n<span class=\"hljs-keyword\">var</span> <span class=\"hljs-keyword\">clone</span> = arr.<span class=\"hljs-keyword\">clone</span>();\n<span class=\"hljs-keyword\">clone</span>[<span class=\"hljs-number\">1</span>].x=<span class=\"hljs-number\">1</span>;\nconsole.log(arr[<span class=\"hljs-number\">1</span>].x) <span class=\"hljs-comment\">// 1</span>\n</code></pre>\n<p>可以看到，<code>clone[1].x</code>改变导致<code>arr[1].x</code>改变，图示如下\n<img src=\"/htm/images/simple_clone1.png\" alt=\"img\"></p>\n<h2><a name=\"-\" class=\"anchor\" href=\"#-\"><span class=\"header-link\"></span></a>深复制</h2><pre><code class=\"lang-javascript\">Object.prototype.clone = function () {\n    <span class=\"hljs-keyword\">var</span> clone = new <span class=\"hljs-keyword\">this</span>.<span class=\"hljs-keyword\">constructor</span>(); <span class=\"hljs-comment\">//开辟新内存空间，保证clone出来的对象也有一个属性能够指向原对象的原型对象。</span>\n    <span class=\"hljs-keyword\">for</span>(<span class=\"hljs-keyword\">var</span> k <span class=\"hljs-keyword\">in</span> <span class=\"hljs-keyword\">this</span>){\n        <span class=\"hljs-keyword\">if</span>(!<span class=\"hljs-keyword\">this</span>.hasOwnProperty(k)) <span class=\"hljs-keyword\">continue</span>;\n        <span class=\"hljs-keyword\">if</span>(typeof <span class=\"hljs-keyword\">this</span>[k] === <span class=\"hljs-string\">'object'</span>)\n            clone[k] = <span class=\"hljs-keyword\">this</span>[k].clone();\n        <span class=\"hljs-keyword\">else</span>\n            clone[k] = <span class=\"hljs-keyword\">this</span>[k];\n    }\n    <span class=\"hljs-keyword\">return</span> clone;\n};\n</code></pre>\n<p>利用递归来实现Object实例的深复制(重新开辟一份内存空间)，如图\n<img src=\"/htm/images/deep_clone1.png\" alt=\"img\">\n因为Array也属于Object，上面的代码也适用于Array</p>\n<p><strong>不足之处：不能对DOM元素结点进行复制</strong></p>\n",
//             "head": {
//                 "title": "谈谈JavaScript之数组对象深拷贝",
//                 "date": "30 Apr 2016",
//                 "categories": [
//                     "前端"
//                 ],
//                 "tags": [
//                     "js",
//                     "深拷贝"
//                 ],
//                 "realDate": "2016-04-30 09:46:14"
//             }
//         }
//     },
//     "index": {
//         "tagMap": {
//             "npm": [
//                 "npm命令行小结"
//             ],
//             "linux": [
//                 "linux-C一周学习"
//             ],
//             "c": [
//                 "linux-C一周学习"
//             ],
//             "EMCAScript6": [
//                 "「ECMAScript6」Promise介绍与nodejs实践运用(q.js)"
//             ],
//             "promise": [
//                 "「ECMAScript6」Promise介绍与nodejs实践运用(q.js)"
//             ],
//             "nodejs": [
//                 "「ECMAScript6」Promise介绍与nodejs实践运用(q.js)"
//             ],
//             "js": [
//                 "谈谈JavaScript之数组对象深拷贝",
//                 "requestAnimationFrame_Vs_setInterval"
//             ],
//             "深拷贝": [
//                 "谈谈JavaScript之数组对象深拷贝"
//             ],
//             "html": [
//                 "b_vs_strong_&_i_vs_em_(html标签语义化)"
//             ],
//             "MarkDown": [
//                 "MarkDown语法测试Demo"
//             ]
//         },
//         "sorted": [
//             "npm命令行小结",
//             "linux-C一周学习",
//             "「ECMAScript6」Promise介绍与nodejs实践运用(q.js)",
//             "谈谈JavaScript之数组对象深拷贝",
//             "b_vs_strong_&_i_vs_em_(html标签语义化)",
//             "requestAnimationFrame_Vs_setInterval",
//             "MarkDown语法测试Demo"
//         ]
//     }
// }

function computeDBJson(marked, dir, debug, options) {
    var returnRaw = options.returnRaw;
    var timeFormat = options.timeFormat;
    var skipRegExp = options.skipRegExp;

    var main = {};

    var articlePath = path.join(dir, 'source', '_articles');
    var filenames = fs.readdirSync(articlePath);
    filenames.forEach(function (name, i) {
        var json = getFileJson(marked, articlePath, name, skipRegExp, returnRaw, timeFormat)
        if (json) {
            name = name.replace(/\.[^.]*$/, '');
            if (!json.head.skip) {
                main[name] = json;
                debug && util.info(`marked ${name}, index: ${i}.`);
            } else {
                debug && util.warn(`marked skipped ${name}, index: ${i}.`);
            }
        } else {
            debug && util.pError(`marked failed ${name}, index: ${i}.`);
        }
    })
    debug && util.info(`marked done.`);

    var sortedNames = getSorted(main, timeFormat);
    var tagMap = getTagMap(main, sortedNames);

    var DB = {}
    DB.main = main;
    DB.index = {
        tagMap: tagMap,
        sorted: sortedNames
    }
    return DB;
}

/**
    梳理每个tag下的所有的文章
 */
function getTagMap(main, sortedNames) {
    var tagMap = {};
    sortedNames.forEach(k => {
        var tags = main[k].head.tags;
        if (!Array.isArray(tags) && tags) {
            tags = [tags];
        }
        tags && tags.forEach(tag => {
            tagMap[tag] = tagMap[tag] || [];
            tagMap[tag].push(k);
        })
    })
    return tagMap;
}
/**
    知道对象的所有属性，原生js给我们提供了一个很好的方法：Object.keys()，该方法返回一个数组
    传入对象，返回属性名
 */
function getSorted(main, timeFormat) {
    return Object.keys(main).sort(function (a, b) {
        var d1 = main[b].head.date, d2 = main[a].head.date;
        return new Date(moment(d1, timeFormat).format()) - new Date(moment(d2, timeFormat).format())
    });
}

/**
    将用户书写的markdown文件转化成json的对象格式
    @ marked 
    @ articlePath 文章的路径
    @ name 文章的名称
    @ skipRegExp 符合该正则表达式的article不进行处理
    @ returnRaw 是否返回文件原始内容 Y : 未经marked解析的md源文件内容 N : 经过marked解析的md
    @ timeFormat 日期格式

    返回值

    { 
        content: '
                <h1>
                    <a name="-" class="anchor" href="#-">
                        <span class="header-link"><
                /span>
                        </a>介绍
                    </h1>
                    <p>看了网上许多介绍 
                        <code>Promise</code> 的文章，终于知道 
                        <co
                de>Promise
                        </code> 是什么，干什么的了。\n首先需要指出的是，
                        <strong>promise是es6提
                出的新标准之一</strong>，那么提出这个标准是用来做什么的呢？\n
                        <!--more-->\n写过js
                代码的童鞋一定知道，异步回调函数是js的一大特点，那么异步回调函数带来的问题是什么
                呢？会造成函数嵌套过多，不宜于后期代码的维护，许多的
                        <code>({})</code>也容易把我
                们搞得晕头转向。那么promise便是用来解决该问题。\n那么es6提出这个标准，那么就得有
                人按照这个标准来实现吧，于是百家争鸣，出现许多库(以便在非浏览器环境下使用)，在这
                我介绍 
                        <code>q.js</code>.\n
                        <a href="https://github.com/kriskowal/q">
                            <code>q.js
                            </
                code> github地址
                        </a>
                    </p>\n
                    <h1>
                        <a name="-" class="anchor" href="#-">
                            <span class="
                header-link"></span>
                        </a>使用
                    </h1>
                    <ul>\n
                        <li>安装
                            <code>q.js</code>\n  npm install
                q
                        </li>
                        <li>使用</li>
                    </ul>\n
                    <ol>\n
                        <li>
                            <p>使用
                                <code>Q.nfcall</code>
                            </p>\n
                            <pre>
                                <code
                class="lang-javascript">
                                    <span class="hljs-keyword">var</span> fs = 
                                    <span class=
                "hljs-built_in">require</span>(
                                    <span class="hljs-string">\'fs\'</span>),\n Q   =
                
                                    <span class="hljs-built_in">require</span>(
                                    <span class="hljs-string">\'q\'
                                    </spa
                n>);\n
                                    <span class="hljs-keyword">var</span> promise = Q.nfcall(fs.readFile,
                                    <span
                class="hljs-string">\'run.js\'</span>);\npromise.then(
                                    <span class="hljs-functio
                n">
                                        <span class="hljs-keyword">function</span>(
                                        <span class="hljs-params">data
                                        </sp
                an>)
                                    </span>{\n     
                                    <span class="hljs-built_in">console</span>.log(data);\n },
                                    <sp
                an class="hljs-function">
                                        <span class="hljs-keyword">function</span>(
                                        <span class=
                "hljs-params">err</span>)
                                    </span>{\n     
                                    <span class="hljs-built_in">console
                                    </spa
                n>.err(err);\n });\n
                                </code>
                            </pre>\n
                            <p> 或者可以简写为下面</p>\n
                            <pre>
                                <code> promi
                se.
                                    <span class="hljs-keyword">then</span>(
                                    <span class="hljs-built_in">console
                                    </s
                pan>.log,
                                    <span class="hljs-built_in">console</span>.err);\n
                                </code>
                            </pre>
                        </li>
                        <li
                >
                            <p>使用
                                <code>Q.deferd</code>
                            </p>\n
                            <pre>
                                <code class="lang-javascript">
                                    <span clas
                s="hljs-keyword">var</span> preadFile = 
                                    <span class="hljs-function">
                                        <span class=
                "hljs-keyword">function</span>(
                                        <span class="hljs-params">file</span>)
                                    </span>{\n

                                    <span class="hljs-keyword">var</span> deferred = Q.defer();\n fs.readFile(file,
                
                                    <span class="hljs-function">
                                        <span class="hljs-keyword">function</span> (
                                        <span c
                lass="hljs-params">error, text</span>) 
                                    </span>{\n     
                                    <span class="hljs-keyword"
                >if</span> (error) {\n         deferred.reject(
                                    <span class="hljs-keyword">new
                                    </s
                pan>
                                    <span class="hljs-built_in">Error</span>(error));\n     } 
                                    <span class="hljs
                -keyword">else</span> {\n         deferred.resolve(text);\n     }\n });\n 
                                    <span
                class="hljs-keyword">return</span> deferred.promise;\n};\npreadFile(
                                    <span class=
                "hljs-string">\'run.js\'</span>).then(
                                    <span class="hljs-built_in">console</span>
                .log,
                                    <span class="hljs-built_in">console</span>.err);\n
                                </code>
                            </pre>\n
                        </li>
                        <li><
                p>还可以用
                            <code>Q.all</code>实现
                            <strong>同步方式</strong>
                        </p>\n
                        <pre>
                            <code class=
                "lang-javascript">
                                <span class="hljs-keyword">var</span> promise = Q.all([Q.nfcal
                l(fs.readFile,
                                <span class="hljs-string">\'run.js\'</span>),preadFile(
                                <span class
                ="hljs-string">\'event.js\'</span>),preadFile(
                                <span class="hljs-string">\'nofoun
                d.js\'</span>)]);\npromise.then(
                                <span class="hljs-function">
                                    <span class="hljs-ke
                yword">function</span>(
                                    <span class="hljs-params">data</span>)
                                </span>{
                                <span class
                ="hljs-built_in">console</span>.log(data.toString())},
                                <span class="hljs-built_in
                ">console</span>.error);\n
                            </code>
                        </pre>\n
                        <p> 因为
                            <code>nofound.js</code>不存在所
                以会抛出异常，其他文件即使存在也不会正确执行.
                        </p>\n
                    </li>
                    <li>
                        <p>多层嵌套
                            <strong>
                异步方式</strong>\n```javascript\nvar preadFile = function(file){\n var deferred
                = Q.defer();\n fs.readFile(file,  function (error, text) {
                        </p>\n
                        <pre>
                            <code>
                                <sp
                an class="hljs-keyword">if
                                </span> (
                                <span class="hljs-keyword">error</span>) {\n
                    deferred.reject(new Error(
                                <span class="hljs-keyword">error</span>));\n } 
                                <sp
                an class="hljs-keyword">else
                                </span> {\n     deferred.resolve({data:
                                <span class="
                hljs-built_in">text</span>,
                                <span class="hljs-built_in">file</span>:
                                <span class="
                hljs-built_in">file</span>});\n }\n
                            </code>
                        </pre>
                        <p> });\n return deferred.promis
                e;\n};</p>\n
                    </li>
                </ol>\n
                <p>preadFile(&#39;run.js&#39;)\n    .then(function (d) {
                \n        console.log(d);\n        return d.file+&#39;xx&#39;;\n    })\n    .the
                n(preadFile)  //上面return d.file 传递到preadFile中\n    .then(function (d) {\n
                    console.log(d);\n        return d.file;\n    })\n    .catch(function (e)
                {\n        console.log(e);\n    }).done(function (e) {//最后一个then return的参
                数\n        console.log(e);\n    });\n
                    <code>``\n    上面的代码</code>run.js
                    <code
                >将会正确输出，但是因为不存在</code>run.jsxx
                    <code>文件所以会捕获错误，但不影响
                    </
                code>run.js`的输出。
                </p>\n
                <h1>
                    <a name="-" class="anchor" href="#-">
                        <span class="
                header-link"></span>
                    </a>尾声
                </h1>
                <p>更多的用法参考
                    <a href="https://github.com/kr
                iskowal/q">
                        <code>q.js</code> github地址
                    </a>\n原来我以前一直使用的 
                    <code>$.ajax({
                }).fail().done()</code> 正是promise方式的一种。
                </p>\n',
                head:
                { title: '「ECMAScript6」Promise介绍与nodejs实践运用(q.js)',
                    date: '01 May 2016',
                    categories: [ '后端' ],
                    tags: [ 'EMCAScript6', 'promise', 'nodejs' ],
                    realDate: '2016-05-01 09:56:42' } }
                [INFO] marked 「ECMAScript6」Promise介绍与nodejs实践运用(q.js), index: 5.
                { content: '
                <h1>
                    <a name="-" class="anchor" href="#-">
                        <span class="header-link"><
                /span>
                        </a>回忆
                    </h1>
                    <p>上周百度面试问了我关于数组的 
                        <code>clone</code> 方法的实现
                ，当时没来得及细想，然后口头上说
                    </p>\n
                    <blockquote>\n
                        <p>数组就是一串数据序列，可
                以遍历然后进行深拷贝即可。</p>\n
                    </blockquote>\n
                    <p>关于细节实现的东西都没想，然后
                面试官那边好像就无语了... 不过好在我提到了 
                        <code>深拷贝</code> 这个关键字。\n
                        <!-
                -more-->
                    </p>\n
                    <h1>
                        <a name="-clone" class="anchor" href="#-clone">
                            <span class="he
                ader-link"></span>
                        </a>再探clone
                    </h1>
                    <h2>
                        <a name="-" class="anchor" href="#-">
                            <sp
                an class="header-link">
                            </span>
                        </a>浅复制
                    </h2>
                    <p>先看第一段代码</p>\n
                    <pre>
                        <code c
                lass="lang-javascript">
                            <span class="hljs-built_in">Array</span>.prototype.clone
                = 
                            <span class="hljs-function">
                                <span class="hljs-keyword">function</span>(
                                <span c
                lass="hljs-params"></span>)
                            </span>{\n    
                            <span class="hljs-keyword">return</span
                >
                            <span class="hljs-keyword">this</span>.slice();\n}\n
                        </code>
                    </pre>\n
                    <p>乍看一下
                ，好像挺快捷方便的就完成了。实际上，懂得c++/java中浅拷贝/深拷贝的人一看便知道这
                只是实现了浅复制。\n测试代码如下，</p>\n
                    <pre>
                        <code class="lang-javascript">
                            <span
                class="hljs-keyword">var</span> arr = [
                            <span class="hljs-number">1</span>,
                            <span
                class="hljs-keyword">new</span>
                            <span class="hljs-function">
                                <span class="hljs-k
                eyword">function</span>
                                <span class="hljs-params">(x)</span>
                            </span>{\n
                        this.x=x;\n               }(
                            <span class="hljs-number">3</span>)];\n
                            <spa
                n class="hljs-keyword">var
                            </span>
                            <span class="hljs-keyword">clone</span> = arr.

                            <span class="hljs-keyword">clone</span>();\n
                            <span class="hljs-keyword">clone
                            </sp
                an>[
                            <span class="hljs-number">1</span>].x=
                            <span class="hljs-number">1</span>;\nc
                onsole.log(arr[
                            <span class="hljs-number">1</span>].x) 
                            <span class="hljs-comment"
                >// 1</span>\n
                        </code>
                    </pre>\n
                    <p>可以看到，
                        <code>clone[1].x</code>改变导致
                        <code>a
                rr[1].x</code>改变，图示如下\n
                        <img src="/htm/images/simple_clone1.png" alt="img"
                >
                        </p>\n
                        <h2>
                            <a name="-" class="anchor" href="#-">
                                <span class="header-link"></span
                >
                            </a>深复制
                        </h2>
                        <pre>
                            <code class="lang-javascript">Object.prototype.clone = func
                tion () {\n    
                                <span class="hljs-keyword">var</span> clone = new 
                                <span class="hl
                js-keyword">this</span>.
                                <span class="hljs-keyword">constructor</span>(); 
                                <span c
                lass="hljs-comment">//开辟新内存空间，保证clone出来的对象也有一个属性能够指向原
                对象的原型对象。</span>\n    
                                <span class="hljs-keyword">for</span>(
                                <span class="
                hljs-keyword">var</span> k 
                                <span class="hljs-keyword">in</span>
                                <span class="hlj
                s-keyword">this</span>){\n        
                                <span class="hljs-keyword">if</span>(!
                                <span cl
                ass="hljs-keyword">this</span>.hasOwnProperty(k)) 
                                <span class="hljs-keyword">con
                tinue</span>;\n        
                                <span class="hljs-keyword">if</span>(typeof 
                                <span class="
                hljs-keyword">this</span>[k] === 
                                <span class="hljs-string">\'object\'</span>)\n
                        clone[k] = 
                                <span class="hljs-keyword">this</span>[k].clone();\n
                
                                <span class="hljs-keyword">else</span>\n            clone[k] = 
                                <span class="hl
                js-keyword">this</span>[k];\n    }\n    
                                <span class="hljs-keyword">return</span>
                clone;\n};\n
                            </code>
                        </pre>\n
                        <p>利用递归来实现Object实例的深复制(重新开辟一份内存
                空间)，如图\n
                            <img src="/htm/images/deep_clone1.png" alt="img">\n因为Array也属于O
                bject，上面的代码也适用于Array
                            </p>\n
                            <p>
                                <strong>不足之处：不能对DOM元素结点进行复
                制</strong>
                            </p>\n
        
        
        ',
        head:
        { title: '谈谈JavaScript之数组对象深拷贝',
            date: '30 Apr 2016',
            categories: [ '前端' ],
            tags: [ 'js', '深拷贝' ],
            realDate: '2016-04-30 09:46:14' 
        } 
    }


 */
function getFileJson(marked, articlePath, name, skipRegExp, returnRaw, timeFormat) {
    var filePath = path.join(articlePath, name);
    var stat = fs.statSync(filePath);
    if (stat.isFile() && !skipRegExp.test(name)) {
        var string = fs.readFileSync(filePath).toString("utf-8");

        var head = {};
        /**
        md文件的头部信息
            ---
            title: {{ title }}
            date: {{ date }}
            categories:
            tags:
            skip: false
            ---

        js原生函数replace ,参数为function的时候收
        str.replace(reg,function($1,$2,$3)){
            //$1 为整个匹配你reg的字符串
            //$2-$n-1为匹配你reg要捕获的内容
        }
        
         */
        string = string.replace(/^\s*?---([\s\S]+?)---/m, function (m, c) {
            /*m 正则匹配的整体
             c 的取值
            title: {{ title }}
            date: {{ date }}
            categories:
            tags:
            skip: false

             */
            var arr = c.split('\n').filter(x => x.trim() != '');// arr = ["title: {{ title }}","date: {{ date }}",....]
            /**
                js的map方法返回的是Array类型
                返回的数组的成员取决于制定的正则表达式是否舍友全局 g的标识
                - regExp 没有 "g"  match只查找第一个匹配，并返回包含查找结果的数组,该数组的成员是个对象
                 {
                    索引      : 存放第一个匹配的字符串
                    属性index : 匹配文本在字符串中的起始索引位置
                    属性input ： 整个字符串对象
                 }
                - regExp 有 "g"   match会查找所有的匹配，返回的数组不再有index和input属性，数组元素就是所有匹配到的字符串
*/
               // 例如 "title: {{ title }}".match(/(.+?)\s*:\s*(.+)\s*/)
               /**
                返回值
                0:"title: {{ title }}"
                1:"title"
                2:"{{ title }}"
                index:0
                input:"title: {{ title }}"
                length:3

             */
             //"title: {{ title }}".match(/(.+?)\s*:\s*(.+)\s*/g)
             /**
                返回值
                ["title: {{ title }}"]
            arr = arr.map(x => x.match(/(.+?)\s*:\s*(.+)\s*/))
            arr.forEach(x => {
                if (x && x.length >= 3) {
                    if (/^\[.*\]$/.test(x[2])) {
                        x[2] = x[2].substr(1, x[2].length - 2);
                        x[2] = x[2].split(",").map(x => x.trim()).filter(x => x != '');
                    }
                    //通过trim函数判断x[2]是字符串还是数组，字符串含有trim方法，数组不含trim方法
                    if (!!x[2].trim) {
                        var val = x[2].trim();
                        if (/^true$/.test(val)) {
                            val = true;
                        } else if (/^false/.test(val)) {
                            val = false;
                        }
                        head[x[1]] = val;
                    } else {
                        head[x[1]] = x[2];
                    }

                }
            });
            return '';
        });
        if (Object.keys(head).length == 0) {
            return;
        }
        if (!returnRaw) {
            var html = marked(string);
        } else {
            var html = string;
        }
        if (head.date) {
            head.realDate = head.date
            head.date = moment(head.date, 'YYYY-MM-DD HH:mm:ss').format(timeFormat)
        }
        console.log({content: html, head: head})
        return {content: html, head: head};
    }
}

function initMarked(markedConfig, marked) {
    var markedOptions = markedConfig.options;
    delete markedOptions.renderer;

    var renderer = new marked.Renderer();
    marked.setOptions(util.deepAssign({renderer: renderer}, markedOptions));
    marked.setOptions({
        highlight: function (code) {
            return require('highlight.js').highlightAuto(code).value;
        }
    });


    if (typeof markedConfig.setup === 'function') {
        markedConfig.setup(renderer);
    }
    return marked;
}