import { execSync } from 'node:child_process';

/**
 * Tự động Add, Commit và Push code (ESM Version).
 * Sử dụng: 
 *   node push.js                -> Commit với message "update code"
 *   node push.js "nội dung"     -> Commit với message tùy chỉnh
 */

const message = process.argv[2] || "update code";

try {
    console.log('\x1b[36m%s\x1b[0m', 'Step 1: git add .');
    execSync('git add .', { stdio: 'inherit' });

    console.log('\x1b[36m%s\x1b[0m', `Step 2: git commit -m "${message}"`);
    const status = execSync('git status --porcelain').toString();
    if (!status) {
        console.log('\x1b[33m%s\x1b[0m', 'No changes to commit.');
    } else {
        execSync(`git commit -m "${message}"`, { stdio: 'inherit' });
    }

    console.log('\x1b[36m%s\x1b[0m', 'Step 3: git push origin');
    const branch = execSync('git rev-parse --abbrev-ref HEAD').toString().trim();
    execSync(`git push origin ${branch}`, { stdio: 'inherit' });

    console.log('\x1b[32m%s\x1b[0m', '✓ Done! Code đã được đẩy lên GitHub thành công.');
} catch (error) {
    console.error('\x1b[31m%s\x1b[0m', '✘ Lỗi trong quá trình thực hiện.');
}
