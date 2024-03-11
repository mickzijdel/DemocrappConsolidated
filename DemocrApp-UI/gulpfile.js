var gulp = require('gulp'),
    sass = require('gulp-sass'),
    del = require('del'),
    browsersync = require('browser-sync').create();

gulp.task('sass', function() {
  return gulp.src('./src/assets/css/*.scss')
          .pipe(sass().on('error', sass.logError))
          .pipe(gulp.dest('src/assets/css/'))
          .pipe(browsersync.stream());
});

gulp.task('clean', function() {
  var files = [
    './src/assets/css/*.css'
  ];
  return del(files);
})

gulp.task('build', gulp.series('clean', 'sass'));

gulp.task('bs', function() {
  
  browsersync.init({
    server: "src"
  });

  gulp.watch('./src/assets/css/*.scss', gulp.series('sass'));
  gulp.watch('./src/assets/js/*.js').on('change', browsersync.reload);
  gulp.watch('./src/**/*.html').on('change', browsersync.reload);
})

gulp.task('watch', gulp.series('build', 'bs'));