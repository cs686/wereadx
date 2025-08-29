#!/usr/bin/env -S deno run --allow-net --allow-read --allow-env

import { web_shelf_sync } from "../src/apis/web/shelf.ts";
import { web_book_info, web_book_chapterInfos, web_book_chapter_e } from "../src/apis/web/book.ts";

// 缓存文件路径
const CACHE_FILE = "./bookshelf_cache.json";

// 随机延迟函数，模拟人类阅读行为
function getRandomDelay(min = 1000, max = 3000): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

// 异步延迟函数
function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// 保存书架数据到本地缓存
async function saveBookshelfCache(data: any) {
    try {
        await globalThis.Deno.writeTextFile(CACHE_FILE, JSON.stringify(data, null, 2));
    } catch (error) {
        console.warn("⚠️  保存缓存失败:", error.message);
    }
}

// 从本地缓存读取书架数据
async function loadBookshelfCache(): Promise<any | null> {
    try {
        const content = await globalThis.Deno.readTextFile(CACHE_FILE);
        return JSON.parse(content);
    } catch (error) {
        return null; // 缓存文件不存在或读取失败
    }
}

// 检查缓存是否过期（24小时）
function isCacheExpired(cacheData: any): boolean {
    if (!cacheData || !cacheData.timestamp) return true;
    const now = Date.now();
    const cacheTime = cacheData.timestamp;
    const CACHE_DURATION = 24 * 60 * 60 * 1000; // 24小时
    return (now - cacheTime) > CACHE_DURATION;
}

// 简单的命令行参数解析
function parseCliArgs(args: string[]): { command?: string; cookie?: string; help?: boolean; verbose?: boolean; format?: string; bookId?: string; output?: string; refresh?: boolean } {
    let verbose = false;
    let format = "table"; // 默认表格格式
    let bookId = "";
    let output = "";
    let refresh = false; // 是否强制刷新书架数据
    
    const result: { command?: string; cookie?: string; help?: boolean; verbose?: boolean; format?: string; bookId?: string; output?: string; refresh?: boolean } = {};
    
    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === '--help' || arg === '-h') {
            result.help = true;
        } else if (arg === '--verbose' || arg === '-v') {
            result.verbose = true;
        } else if (arg === '--refresh' || arg === '-r') {
            result.refresh = true;
        } else if (arg.startsWith('--format=')) {
            result.format = arg.substring(9);
        } else if (arg === '--format' && i + 1 < args.length) {
            result.format = args[i + 1];
            i++; // 跳过下一个参数
        } else if (arg.startsWith('--cookie=')) {
            result.cookie = arg.substring(9);
        } else if (arg === '--cookie' && i + 1 < args.length) {
            result.cookie = args[i + 1];
            i++; // 跳过下一个参数
        } else if (arg.startsWith('--bookId=')) {
            result.bookId = arg.substring(9);
        } else if (arg === '--bookId' && i + 1 < args.length) {
            result.bookId = args[i + 1];
            i++; // 跳过下一个参数
        } else if (arg.startsWith('--output=')) {
            result.output = arg.substring(9);
        } else if (arg === '--output' && i + 1 < args.length) {
            result.output = args[i + 1];
            i++; // 跳过下一个参数
        } else if (!result.command) {
            result.command = arg;
        }
    }
    
    return result;
}

/**
 * 解析cookie字符串，提取认证信息
 * @param cookieStr cookie字符串，格式如: "wr_vid=123;wr_skey=abc;wr_rt=def;"
 */
function parseCookie(cookieStr: string): { vid: number; skey: string; rt: string } | null {
    try {
        const cookies = cookieStr.split(';').reduce((acc, cookie) => {
            const [key, value] = cookie.trim().split('=');
            if (key && value) {
                acc[key] = value;
            }
            return acc;
        }, {} as Record<string, string>);

        const vid = parseInt(cookies.wr_vid);
        const skey = cookies.wr_skey;
        const rt = cookies.wr_rt;

        if (isNaN(vid) || !skey || !rt) {
            return null;
        }

        return { vid, skey, rt };
    } catch (error) {
        console.error('解析cookie失败:', error.message);
        return null;
    }
}

/**
 * 格式化书籍信息输出
 * @param books 书籍列表
 * @param displayFormat 显示格式：'list' 或 'table'
 */
function formatBookList(books: any[], displayFormat: string = 'table'): void {
    if (!books || books.length === 0) {
        console.log('📚 书架为空');
        return;
    }

    console.log(`📚 书架共有 ${books.length} 本书:\n`);
    
    if (displayFormat === 'table') {
        // 表格格式显示
        console.log('┌─────┬────────────────────────────────────┬──────────────────┬──────────┬──────────┬────────────────────┬────────┐');
        console.log('│ 序号 │                标题                │      作者         │    ID    │   进度    │        分类        │ 格式   │');
        console.log('├─────┼────────────────────────────────────┼──────────────────┼──────────┼──────────┼────────────────────┼────────┤');
        
        books.forEach((book, index) => {
            const title = (book.title || book.bookInfo?.title || '未知标题').substring(0, 30);
            const author = (book.author || book.bookInfo?.author || '未知作者').substring(0, 14);
            const bookId = (book.bookId || book.bookInfo?.bookId || 'N/A').toString().substring(0, 8);
            const progress = book.readingProgress ? `${(book.readingProgress * 100).toFixed(1)}%` : 
                            book.progress ? `${(book.progress * 100).toFixed(1)}%` : '0%';
            const category = (book.category || book.bookInfo?.category || '').substring(0, 18);
            const format = (book.format || book.bookInfo?.format || '').substring(0, 6);
            
            console.log(`│ ${(index + 1).toString().padEnd(3)} │ ${title.padEnd(34)} │ ${author.padEnd(16)} │ ${bookId.padEnd(8)} │ ${progress.padEnd(8)} │ ${category.padEnd(18)} │ ${format.padEnd(6)} │`);
        });
        
        console.log('└─────┴────────────────────────────────────┴──────────────────┴──────────┴──────────┴────────────────────┴────────┘');
    } else {
        // 列表格式显示
        books.forEach((book, index) => {
            const title = book.title || book.bookInfo?.title || '未知标题';
            const author = book.author || book.bookInfo?.author || '未知作者';
            const bookId = book.bookId || book.bookInfo?.bookId || 'N/A';
            const progress = book.readingProgress ? `${(book.readingProgress * 100).toFixed(1)}%` : 
                            book.progress ? `${(book.progress * 100).toFixed(1)}%` : '0%';
            const category = book.category || book.bookInfo?.category || '';
            const format = book.format || book.bookInfo?.format || '';
            
            console.log(`${index + 1}. 📖 ${title}`);
            console.log(`   👤 作者: ${author}`);
            console.log(`   🆔 ID: ${bookId}`);
            console.log(`   📊 进度: ${progress}`);
            if (category) console.log(`   📂 分类: ${category}`);
            if (format) console.log(`   📄 格式: ${format}`);
            console.log('');
        });
    }
}

/**
 * 获取书架列表
 * @param cookie cookie字符串
 * @param verbose 是否显示详细信息
 * @param displayFormat 显示格式
 */
async function getBookshelf(cookie: string, verbose = false, displayFormat = "table", refresh = false): Promise<void> {
    const parsedCookie = parseCookie(cookie);
    if (!parsedCookie) {
        console.error('❌ Cookie格式无效，请检查cookie参数');
        console.error('正确格式示例: "wr_vid=123456;wr_skey=abcdef;wr_rt=ghijkl;"');
        console.error('\n📝 Cookie获取方法:');
        console.error('1. 在浏览器中登录微信读书网页版');
        console.error('2. 打开开发者工具 (F12)');
        console.error('3. 在Network标签页中找到任意请求');
        console.error('4. 复制请求头中的Cookie值');
        return;
    }

    if (verbose) {
        console.log('🔧 解析到的认证信息:');
        console.log(`   用户ID: ${parsedCookie.vid}`);
        console.log(`   会话密钥: ${parsedCookie.skey.substring(0, 10)}...`);
        console.log(`   刷新令牌: ${parsedCookie.rt.substring(0, 10)}...`);
    }

    try {
        let books = [];
        let fromCache = false;
        
        // 如果不是强制刷新，先尝试读取缓存
        if (!refresh) {
            const cacheData = await loadBookshelfCache();
            if (cacheData && !isCacheExpired(cacheData)) {
                books = cacheData.books || [];
                fromCache = true;
                if (verbose) {
                    console.log('📁 使用本地缓存数据 (缓存时间:', new Date(cacheData.timestamp).toLocaleString(), ')');
                }
            }
        }
        
        // 如果没有有效缓存或强制刷新，则请求API
        if (!fromCache || refresh) {
            console.log('🔍 正在获取书架信息...');
            const startTime = Date.now();
            const response = await web_shelf_sync({}, cookie);
            const endTime = Date.now();
            
            if (verbose) {
                console.log(`⏱️  请求耗时: ${endTime - startTime}ms`);
                console.log('📡 API响应:', JSON.stringify(response, null, 2).substring(0, 200) + '...');
            }
            
            // 检查响应是否包含错误
            if (response.errCode && response.errCode !== 0) {
                console.error('❌ 获取书架失败:', response.errMsg || '未知错误');
                console.error(`   错误代码: ${response.errCode}`);
                
                if (response.errCode === -2012 || response.errCode === -2013) {
                    console.error('\n💡 解决方案:');
                    console.error('1. Cookie可能已过期，请重新获取');
                    console.error('2. 确保在微信读书网页版中已正常登录');
                    console.error('3. 检查网络连接是否正常');
                }
                
                if (verbose) {
                    console.error('\n🔍 完整响应:', JSON.stringify(response, null, 2));
                }
                return;
            }
            
            // 成功获取数据
            books = response.books || [];
            
            // 保存到缓存
            await saveBookshelfCache({
                books: books,
                timestamp: Date.now()
            });
            
            if (verbose) {
                console.log('💾 书架数据已保存到本地缓存');
            }
        }
        
        if (fromCache) {
            console.log('📁 [本地缓存] 书架列表:');
        } else {
            console.log('🌐 [最新数据] 书架列表:');
        }
        
        formatBookList(books, displayFormat);
        
        if (verbose && books.length > 0) {
            console.log('\n📊 统计信息:');
            const formats = books.reduce((acc: Record<string, number>, book: any) => {
                const format = book.format || book.bookInfo?.format || 'unknown';
                acc[format] = (acc[format] || 0) + 1;
                return acc;
            }, {});
            Object.entries(formats).forEach(([format, count]) => {
                console.log(`   ${format}: ${count} 本`);
            });
        }
    } catch (error) {
        console.error('❌ 网络请求失败:', error.message);
        
        if (verbose) {
            console.error('\n🔍 错误详情:', error.stack);
        }
        
        console.error('\n💡 可能的原因:');
        console.error('1. 网络连接问题');
        console.error('2. 微信读书服务器暂时不可用');
        console.error('3. Cookie格式错误或已失效');
        return;
    }
}

/**
 * 下载书籍
 * @param bookId 书籍ID
 * @param cookie cookie字符串
 * @param outputPath 输出文件路径
 * @param verbose 是否显示详细信息
 */
async function downloadBook(bookId: string, cookie: string, outputPath?: string, verbose = false): Promise<void> {
    try {
        console.log(`📖 正在下载书籍 ${bookId}...`);
        
        // 获取书籍信息
        const bookInfo = await web_book_info(bookId, cookie);
        if (bookInfo.errCode && bookInfo.errCode !== 0) {
            console.error(`❌ 获取书籍信息失败: ${bookInfo.errMsg || "未知错误"}`);
            return;
        }
        
        const { title, author, format } = bookInfo;
        console.log(`📚 书名: ${title}`);
        console.log(`👤 作者: ${author}`);
        console.log(`📄 格式: ${format}`);
        console.log();
        
        // 获取章节信息
        const chapterResponse = await web_book_chapterInfos([bookId], cookie);
        if (chapterResponse.errCode && chapterResponse.errCode !== 0) {
            console.error(`❌ 获取章节信息失败: ${chapterResponse.errMsg || "未知错误"}`);
            return;
        }
        
        const chapters = chapterResponse.data?.[0]?.updated || [];
        if (chapters.length === 0) {
            console.error("❌ 未找到章节信息");
            return;
        }
        
        console.log(`📑 共 ${chapters.length} 个章节`);
        console.log();
        
        // 下载所有章节
        const htmlContents: string[] = [];
        for (let i = 0; i < chapters.length; i++) {
            const chapter = chapters[i];
            const chapterUid = chapter.chapterUid;
            
            if (verbose) {
                console.log(`⬇️  下载章节 ${i + 1}/${chapters.length}: ${chapter.title || `章节 ${chapterUid}`}`);
            } else {
                // 显示进度
                 const progress = Math.round((i / chapters.length) * 100);
                 console.log(`⬇️  下载进度: ${progress}% (${i + 1}/${chapters.length})`);
            }
            
            try {
                const chapterContent = await web_book_chapter_e(bookId, chapterUid, cookie);
                htmlContents.push(chapterContent);
                
                // 添加随机延迟，模拟人类阅读行为
                const delay = getRandomDelay(800, 2000);
                if (verbose) {
                    console.log(`   ⏱️  等待 ${delay}ms...`);
                }
                await sleep(delay);
            } catch (error) {
                console.error(`\n❌ 下载章节 ${chapterUid} 失败: ${error.message}`);
                continue;
            }
        }
        
        if (!verbose) {
            console.log(); // 换行
        }
        
        if (htmlContents.length === 0) {
            console.error("❌ 没有成功下载任何章节");
            return;
        }
        
        // 合并所有章节内容
        const fullHtml = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title} - ${author}</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; max-width: 800px; margin: 0 auto; padding: 20px; }
        .book-header { text-align: center; margin-bottom: 40px; border-bottom: 2px solid #eee; padding-bottom: 20px; }
        .book-title { font-size: 2em; font-weight: bold; margin-bottom: 10px; }
        .book-author { font-size: 1.2em; color: #666; }
        .chapter { margin-bottom: 30px; page-break-before: always; }
        .chapter-title { font-size: 1.5em; font-weight: bold; margin-bottom: 20px; color: #333; }
        p { margin-bottom: 1em; text-indent: 2em; }
    </style>
</head>
<body>
    <div class="book-header">
        <h1 class="book-title">${title}</h1>
        <p class="book-author">作者: ${author}</p>
        <p>格式: ${format} | 章节数: ${htmlContents.length}</p>
    </div>
    
    ${htmlContents.map((content, index) => {
      const chapterTitle = chapters[index]?.title || `第 ${index + 1} 章`;
      return `<div class="chapter">
        <h2 class="chapter-title">${chapterTitle}</h2>
        ${content}
      </div>`;
    }).join('\n\n')}
</body>
</html>`;
        
        // 保存文件
        const fileName = outputPath || `${title.replace(/[<>:"/\\|?*]/g, '_')}_${bookId}.html`;
        await globalThis.Deno.writeTextFile(fileName, fullHtml);
        
        console.log(`✅ 下载完成!`);
        console.log(`📁 文件保存为: ${fileName}`);
        console.log(`📊 成功下载 ${htmlContents.length}/${chapters.length} 个章节`);
        
    } catch (error) {
        console.error(`❌ 下载失败: ${error.message}`);
        console.log();
        console.log("💡 可能的原因:");
        console.log("1. 网络连接问题");
        console.log("2. 书籍ID不存在或无权限访问");
        console.log("3. Cookie格式错误或已失效");
    }
}

/**
 * 显示帮助信息
 */
function showHelp(): void {
    console.log(`
📚 WeReadX CLI 工具
`);
    console.log('用法:');
    console.log('  bunx cli.ts bookshelf --cookie="wr_vid=123;wr_skey=abc;wr_rt=def;"\n');
    console.log('命令:');
    console.log('  bookshelf    获取书架上的书籍列表');
    console.log('  download     下载指定书籍\n');
    console.log('选项:');
    console.log('  --cookie     微信读书的登录cookie (必需)');
    console.log('  --format     显示格式: table(表格) 或 list(列表)，默认为table');
    console.log('  --bookId     书籍ID (download命令必需)');
    console.log('  --output     输出文件路径 (可选)');
    console.log('  --refresh    强制刷新书架数据，忽略本地缓存');
    console.log('  --verbose    显示详细信息和调试输出');
    console.log('  --help       显示帮助信息\n');
    console.log('示例:');
    console.log('  bunx cli.ts bookshelf --cookie="wr_vid=123456;wr_skey=abcdef123;wr_rt=ghijkl456;"');
    console.log('  bunx cli.ts bookshelf --cookie="..." --format=list');
    console.log('  bunx cli.ts bookshelf --cookie="..." --format=table --verbose');
    console.log('  bunx cli.ts download --bookId=12345 --cookie="..."');
    console.log('  bunx cli.ts download --bookId=12345 --cookie="..." --output=mybook.html\n');
}

/**
 * 主函数
 */
async function main(): Promise<void> {
    const args = parseCliArgs(globalThis.Deno?.args || []);

    // 显示帮助
    if (args.help || !args.command) {
        showHelp();
        return;
    }

    const command = args.command;

    switch (command) {
        case 'bookshelf':
            if (!args.cookie) {
                console.error('❌ 缺少必需的 --cookie 参数');
                console.error('使用 --help 查看使用说明');
                return;
            }
            const displayFormat = args.format === 'list' ? 'list' : 'table'; // 默认为table
            await getBookshelf(args.cookie, args.verbose, displayFormat, args.refresh);
            break;

        case 'download':
            if (!args.bookId) {
                console.error("❌ 错误: 下载命令需要指定 bookId 参数");
                console.log("💡 使用方法: deno run --allow-net --allow-read --allow-env --allow-write bin/cli.ts download --bookId=<书籍ID> --cookie=<cookie> [--output=<输出文件名>]");
                return;
            }
            if (!args.cookie) {
                console.error('❌ 缺少必需的 --cookie 参数');
                console.error('使用 --help 查看使用说明');
                return;
            }
            await downloadBook(args.bookId, args.cookie, args.output, args.verbose);
            break;

        default:
            console.error(`❌ 未知命令: ${command}`);
            console.error('使用 --help 查看可用命令');
            return;
    }
}

// 运行主函数
main().catch((error) => {
    console.error('❌ 程序执行失败:', error.message);
});