// Should not be marked as similar to any other function in the test_dir
const uniqueFunction = () => {
    return 1;
}

function thirdLevelFunction() {
    let x = 1;
    const foo = () => {
        return x + 1;
    }
    var bar = true
    if (bar) {
        Promise.resolve().then(() => {
            console.log(foo());
        });
    }
}