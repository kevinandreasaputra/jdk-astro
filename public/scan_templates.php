<?php
header('Access-Control-Allow-Origin: *');
header('Content-Type: application/json');

$dir = 'images/cert_templates';
$files = [];

if (is_dir($dir)) {
    $scan = scandir($dir);
    foreach($scan as $file) {
        // Filter out . and .. and hidden files
        if ($file !== '.' && $file !== '..' && $file[0] !== '.') {
            // Only allow specific image types and PDF
            if (preg_match('/\.(png|jpg|jpeg|webp|pdf)$/i', $file)) {
                $files[] = $dir . '/' . $file;
            }
        }
    }
}

echo json_encode($files);
?>
