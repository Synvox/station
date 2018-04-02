cd client
npm run build
cd ../

cd server
npm run build
cd ../


cd client
npm publish --access public
cd ../

cd server
npm publish --access public
cd ../
